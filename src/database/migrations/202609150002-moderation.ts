import { DatabaseMigration } from "./migration.types";
import { executeSqlStatements } from "./sql-migration.helpers";

/**
 * Motor de moderación: reportes, sanciones y ocultamiento de contenido.
 *
 * El diseño copia deliberadamente dos productos que llevan una década
 * moderando contenido social a escala, porque los dos resolvieron problemas que
 * aquí aparecerían igual:
 *
 * ## De Facebook: la escalera de sanciones
 *
 * La duración de una suspensión NO la elige quien modera, la calcula el
 * historial (`user_strikes`). Un moderador cansado a las siete de la tarde
 * castiga distinto que uno recién llegado, y dos personas con la misma falta
 * acabando con castigos distintos es lo que convierte la moderación en algo
 * que se discute en vez de algo que se acata. Por eso las sanciones **caducan**
 * (`expires_at`): una falta de hace dos años no debe pesar como una de ayer.
 *
 * ## De Facebook: un caso es el CONTENIDO, no cada queja
 *
 * Cinco personas que reportan la misma foto son un caso con cinco reportes, no
 * cinco tareas. Las filas siguen siendo una por denunciante —hace falta saber
 * quién se quejó y de qué, y avisarle luego— pero la cola agrupa por
 * `(target_kind, target_id)` y resolver cierra todas a la vez.
 *
 * ## De Tinder: ocultar antes de que llegue un humano
 *
 * Cuando varias personas DISTINTAS reportan lo mismo, el contenido se oculta
 * solo, sin esperar a la cola. Es reversible (`hidden_at` vuelve a NULL si se
 * descarta el caso) y protege a quien lo está viendo ahora, no dentro de seis
 * horas.
 *
 * ## Ocultar no es borrar
 *
 * `hidden_at` apaga la FILA; el binario en MinIO no se toca nunca (ADR-0010).
 * Es lo que permite revisar un caso, revertirlo, y conservar la prueba de lo
 * que se moderó.
 */
const upStatements = [
  `CREATE SCHEMA IF NOT EXISTS moderation`,

  `CREATE TABLE moderation.reports (
     id uuid PRIMARY KEY,
     tenant_id varchar(60) NOT NULL REFERENCES public.tenants(id),
     reporter_user_id uuid NOT NULL REFERENCES public.usuarios(id) ON DELETE CASCADE,
     -- Dueño del contenido reportado. Se guarda resuelto y no se deduce al
     -- leer: la story puede desaparecer y el caso tiene que seguir sabiendo
     -- sobre quién iba.
     reported_user_id uuid NOT NULL REFERENCES public.usuarios(id) ON DELETE CASCADE,
     target_kind varchar(20) NOT NULL,
     target_id uuid NOT NULL,
     reason varchar(30) NOT NULL,
     details text,
     status varchar(20) NOT NULL DEFAULT 'PENDIENTE',
     resolution varchar(30),
     resolution_note text,
     resolved_by_user_id uuid REFERENCES public.usuarios(id) ON DELETE SET NULL,
     resolved_at timestamptz,
     -- Quién tiene el caso en la mano ahora mismo. Evita que dos personas
     -- revisen lo mismo y tomen decisiones distintas sobre la misma foto.
     claimed_by_user_id uuid REFERENCES public.usuarios(id) ON DELETE SET NULL,
     claimed_at timestamptz,
     created_at timestamptz NOT NULL DEFAULT now(),
     updated_at timestamptz NOT NULL DEFAULT now(),
     CONSTRAINT ck_moderation_report_target_kind
       CHECK (target_kind IN ('STORY', 'PROFILE_PHOTO', 'CHAT_MESSAGE', 'USER')),
     CONSTRAINT ck_moderation_report_reason
       CHECK (reason IN ('CONTENIDO_SEXUAL', 'ACOSO', 'DISCURSO_DE_ODIO', 'VIOLENCIA',
                         'SPAM', 'PERFIL_FALSO', 'MENOR_DE_EDAD', 'DROGAS', 'OTRO')),
     CONSTRAINT ck_moderation_report_status
       CHECK (status IN ('PENDIENTE', 'EN_REVISION', 'RESUELTO', 'DESCARTADO')),
     CONSTRAINT ck_moderation_report_resolution
       CHECK (resolution IS NULL OR resolution IN
              ('SIN_ACCION', 'CONTENIDO_OCULTO', 'USUARIO_ADVERTIDO',
               'USUARIO_SUSPENDIDO', 'USUARIO_EXPULSADO')),
     -- Nadie se reporta a sí mismo: no es una acción con sentido y ensucia la
     -- cola con casos que no se pueden resolver.
     CONSTRAINT ck_moderation_report_not_self
       CHECK (reporter_user_id <> reported_user_id),
     -- Un caso resuelto tiene resolución y responsable; uno abierto no los
     -- tiene. Sin esto la tabla admite un "resuelto" sin decir cómo ni por
     -- quién, que es precisamente lo que un registro de moderación no puede
     -- permitirse.
     CONSTRAINT ck_moderation_report_resolution_complete
       CHECK (
         (status IN ('RESUELTO', 'DESCARTADO'))
         = (resolution IS NOT NULL AND resolved_at IS NOT NULL)
       )
   )`,

  // La misma persona no puede tener dos quejas abiertas sobre lo mismo. Repetir
  // el reporte no añade información y sí inflaría el contador que dispara el
  // auto-ocultado, convirtiendo a un solo usuario insistente en una turba.
  `CREATE UNIQUE INDEX uq_moderation_report_open
     ON moderation.reports (reporter_user_id, target_kind, target_id)
   WHERE status IN ('PENDIENTE', 'EN_REVISION')`,

  // La cola: casos abiertos del gimnasio, del más antiguo al más nuevo.
  `CREATE INDEX ix_moderation_reports_queue
     ON moderation.reports (tenant_id, status, created_at)`,

  // Agrupar las quejas de un mismo contenido, y contar denunciantes distintos.
  `CREATE INDEX ix_moderation_reports_target
     ON moderation.reports (target_kind, target_id)`,

  // "¿Qué se ha reportado de esta persona?" — la pregunta que se hace antes de
  // decidir una sanción.
  `CREATE INDEX ix_moderation_reports_reported_user
     ON moderation.reports (reported_user_id, created_at DESC)`,

  `CREATE TABLE moderation.user_strikes (
     id uuid PRIMARY KEY,
     user_id uuid NOT NULL REFERENCES public.usuarios(id) ON DELETE CASCADE,
     tenant_id varchar(60) NOT NULL REFERENCES public.tenants(id),
     kind varchar(20) NOT NULL,
     reason varchar(30) NOT NULL,
     note text,
     target_kind varchar(20),
     target_id uuid,
     issued_by_user_id uuid REFERENCES public.usuarios(id) ON DELETE SET NULL,
     -- Hasta cuándo dura la suspensión que produjo esta sanción. NULL en una
     -- advertencia (no suspende) y en una expulsión (no termina).
     suspended_until timestamptz,
     -- Cuándo deja de contar para la escalera. Una falta no pesa para siempre.
     expires_at timestamptz NOT NULL,
     created_at timestamptz NOT NULL DEFAULT now(),
     CONSTRAINT ck_moderation_strike_kind
       CHECK (kind IN ('ADVERTENCIA', 'SUSPENSION', 'EXPULSION'))
   )`,

  // La consulta que alimenta la escalera: sanciones vigentes de una persona.
  `CREATE INDEX ix_moderation_strikes_active
     ON moderation.user_strikes (user_id, expires_at DESC)`,

  // Ocultamiento de contenido. `hidden_at` apaga la fila; el binario se queda.
  `ALTER TABLE profile.stories
     ADD COLUMN hidden_at timestamptz,
     ADD COLUMN hidden_by_user_id uuid REFERENCES public.usuarios(id) ON DELETE SET NULL,
     ADD COLUMN hidden_reason varchar(30)`,

  `ALTER TABLE profile.photos
     ADD COLUMN hidden_at timestamptz,
     ADD COLUMN hidden_by_user_id uuid REFERENCES public.usuarios(id) ON DELETE SET NULL,
     ADD COLUMN hidden_reason varchar(30)`,

  // Índices parciales: lo que se lee constantemente es el contenido VISIBLE, y
  // los ocultos son (con suerte) una minoría diminuta.
  `CREATE INDEX ix_profile_stories_visible
     ON profile.stories (user_id, created_at DESC) WHERE hidden_at IS NULL`,
  `CREATE INDEX ix_profile_photos_visible
     ON profile.photos (user_id, position) WHERE hidden_at IS NULL`,

  /**
   * Suspensión temporal de una cuenta.
   *
   * Columna propia y no un valor nuevo de `usuarios.estado`: "suspendido hasta
   * el martes" es una fecha, no un estado, y meterlo en el enum obligaría a un
   * proceso que recorra la tabla devolviendo cuentas a ACTIVO. Con una fecha, la
   * suspensión termina sola.
   */
  `ALTER TABLE public.usuarios
     ADD COLUMN suspended_until timestamptz`,

  `CREATE INDEX ix_usuarios_suspended
     ON public.usuarios (suspended_until) WHERE suspended_until IS NOT NULL`,
] as const;

const downStatements = [
  `DROP INDEX IF EXISTS public.ix_usuarios_suspended`,
  `ALTER TABLE public.usuarios DROP COLUMN IF EXISTS suspended_until`,
  `DROP INDEX IF EXISTS profile.ix_profile_photos_visible`,
  `DROP INDEX IF EXISTS profile.ix_profile_stories_visible`,
  `ALTER TABLE profile.photos
     DROP COLUMN IF EXISTS hidden_reason,
     DROP COLUMN IF EXISTS hidden_by_user_id,
     DROP COLUMN IF EXISTS hidden_at`,
  `ALTER TABLE profile.stories
     DROP COLUMN IF EXISTS hidden_reason,
     DROP COLUMN IF EXISTS hidden_by_user_id,
     DROP COLUMN IF EXISTS hidden_at`,
  `DROP TABLE IF EXISTS moderation.user_strikes`,
  `DROP TABLE IF EXISTS moderation.reports`,
] as const;

export const moderationMigration: DatabaseMigration = {
  id: "202609150002-moderation",
  description:
    "Adds the moderation engine: reports grouped by target, an expiring strike ladder, reversible content hiding and temporary account suspension.",
  up: (queryInterface, transaction) =>
    executeSqlStatements(queryInterface, transaction, upStatements),
  down: (queryInterface, transaction) =>
    executeSqlStatements(queryInterface, transaction, downStatements),
};
