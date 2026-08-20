import { DatabaseMigration } from "./migration.types";
import { executeSqlStatements } from "./sql-migration.helpers";

/**
 * Dos huecos que impedían responder preguntas que el gimnasio ya se hacía.
 *
 * **Qué máquina se usa.** Un ejercicio decía qué equipamiento *requiere* como
 * texto libre —«barra», «mancuernas»—, pero nunca a qué máquina concreta de la
 * sede corresponde. Sin ese vínculo no hay forma de responder cuál es la prensa
 * que nadie toca ni si la sede necesita otra polea, que es la decisión de
 * compra más cara que toman. La columna es opcional: la mayoría de los
 * ejercicios del catálogo son con peso libre y no tienen máquina, y forzar una
 * habría llenado el dato de ruido.
 *
 * **Quién pagó por fuera de la app.** Cuando alguien paga en efectivo, la app
 * no se entera y le corta el acceso al día siguiente. Esta tabla registra la
 * petición que la persona lanza desde su teléfono para que un administrador la
 * active: un enlace de un solo uso, con vida corta, que sólo sirve en manos de
 * quien tiene permiso.
 *
 * El token se guarda hasheado por la misma razón que un PIN de recuperación:
 * quien lea la tabla no debe poder activar cuentas. Y `consumido_por_user_id`
 * deja constancia de qué administrador lo hizo, que es justo lo que una
 * auditoría de caja va a preguntar.
 */
const upStatements = [
  `ALTER TABLE ejercicios
     ADD COLUMN equipo_id uuid REFERENCES equipos_gym (id) ON DELETE SET NULL`,
  // El panel de uso agrupa por máquina; sin índice sería un recorrido completo
  // del catálogo en cada carga.
  `CREATE INDEX ix_ejercicios_equipo ON ejercicios (equipo_id) WHERE equipo_id IS NOT NULL`,

  `CREATE TABLE membership_activation_requests (
     id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     usuario_id uuid NOT NULL REFERENCES usuarios (id) ON DELETE CASCADE,
     token_hash text NOT NULL,
     expira_en timestamptz NOT NULL,
     consumido_en timestamptz,
     consumido_por_user_id uuid REFERENCES usuarios (id) ON DELETE SET NULL,
     nota text,
     created_at timestamptz NOT NULL DEFAULT now(),
     updated_at timestamptz NOT NULL DEFAULT now(),
     CONSTRAINT ck_activation_consumo
       CHECK ((consumido_en IS NULL) = (consumido_por_user_id IS NULL))
   )`,
  `CREATE INDEX ix_activation_requests_vigentes
     ON membership_activation_requests (usuario_id, expira_en)
     WHERE consumido_en IS NULL`,
] as const;

const downStatements = [
  `DROP INDEX IF EXISTS ix_activation_requests_vigentes`,
  `DROP TABLE IF EXISTS membership_activation_requests`,
  `DROP INDEX IF EXISTS ix_ejercicios_equipo`,
  `ALTER TABLE ejercicios DROP COLUMN IF EXISTS equipo_id`,
] as const;

export const equipmentUsageAndCashActivationMigration: DatabaseMigration = {
  id: "202608190003-equipment-usage-and-cash-activation",
  description:
    "Optional machine on an exercise, so usage can be reported per machine; and single-use activation requests for members who paid outside the app.",
  up: (queryInterface, transaction) =>
    executeSqlStatements(queryInterface, transaction, upStatements),
  down: (queryInterface, transaction) =>
    executeSqlStatements(queryInterface, transaction, downStatements),
};
