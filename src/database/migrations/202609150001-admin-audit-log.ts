import { DatabaseMigration } from "./migration.types";
import { executeSqlStatements } from "./sql-migration.helpers";

/**
 * Registro de lo que hace el personal administrativo.
 *
 * Hasta ahora la única acción administrativa que dejaba rastro era conceder un
 * permiso (`admin.user_permissions.granted_by_user_id`). Todo lo demás
 * —desactivar una cuenta, descargar el archivo privado de un socio, ocultar
 * contenido, responder como la cuenta corporativa— no lo registraba nadie, así
 * que la pregunta «¿quién hizo esto?» no tenía respuesta posible. Las consolas
 * que este plan añade multiplican ese tipo de acción, de modo que la tabla va
 * primero y no al final.
 *
 * ## Es de sólo inserción
 *
 * No lleva `updated_at` ni ruta de edición: una fila de auditoría que se puede
 * corregir a posteriori no sirve para auditar. Por la misma razón el actor se
 * guarda DOS veces —la clave foránea y el correo copiado— y la clave usa
 * `ON DELETE SET NULL`: borrar la cuenta del actor no puede borrar el rastro de
 * lo que hizo, y sin la copia del correo la fila sobreviviría vacía de sentido.
 *
 * ## `tenant_scope` nulo significa «toda la plataforma»
 *
 * Es el mismo convenio que `AuthenticatedUser.tenantScope`: nulo = sin filtro,
 * y sólo lo alcanza un `SYSTEM_ADMIN` que no está suplantando. Una consulta
 * acotada a un gimnasio (`WHERE tenant_scope = :scope`) deja fuera esas filas a
 * propósito: lo que se hace a nivel de plataforma no es asunto de un gimnasio.
 */
const upStatements = [
  `CREATE SCHEMA IF NOT EXISTS admin`,
  `CREATE TABLE admin.audit_log (
     id uuid PRIMARY KEY,
     occurred_at timestamptz NOT NULL DEFAULT now(),
     actor_user_id uuid REFERENCES public.usuarios(id) ON DELETE SET NULL,
     actor_email varchar(180) NOT NULL,
     actor_role varchar(40) NOT NULL,
     tenant_scope varchar(60),
     domain varchar(60) NOT NULL,
     action varchar(60) NOT NULL,
     target_kind varchar(60),
     target_id varchar(200),
     metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
     ip inet,
     user_agent text
   )`,

  // El feed global de la consola de sistema: lo último primero. El desempate
  // por `id` no es decorativo — la paginación keyset necesita un orden total, y
  // dos acciones dentro del mismo milisegundo lo romperían sin él.
  `CREATE INDEX ix_admin_audit_log_recent
     ON admin.audit_log(occurred_at DESC, id DESC)`,

  // El feed de un gimnasio. Índice propio y no un filtro sobre el anterior:
  // el gimnasio grande no debe pagar por recorrer la actividad de todos.
  `CREATE INDEX ix_admin_audit_log_tenant
     ON admin.audit_log(tenant_scope, occurred_at DESC, id DESC)`,

  // «¿Qué ha hecho esta persona?», la pregunta que se hace cuando algo ya salió
  // mal.
  `CREATE INDEX ix_admin_audit_log_actor
     ON admin.audit_log(actor_user_id, occurred_at DESC, id DESC)`,

  // «¿Quién ha descargado archivos este mes?»: filtrar por dominio/acción sin
  // recorrer la tabla entera.
  `CREATE INDEX ix_admin_audit_log_action
     ON admin.audit_log(domain, action, occurred_at DESC)`,
] as const;

const downStatements = [`DROP TABLE IF EXISTS admin.audit_log`] as const;

export const adminAuditLogMigration: DatabaseMigration = {
  id: "202609150001-admin-audit-log",
  description:
    "Adds an append-only audit log for administrative actions, scoped by tenant and indexed for the admin and system consoles.",
  up: (queryInterface, transaction) =>
    executeSqlStatements(queryInterface, transaction, upStatements),
  down: (queryInterface, transaction) =>
    executeSqlStatements(queryInterface, transaction, downStatements),
};
