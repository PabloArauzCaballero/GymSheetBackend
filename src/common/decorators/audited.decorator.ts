import { SetMetadata } from '@nestjs/common';

export const AUDITED_KEY = 'audited';

export type AuditedMetadata = {
  /** Familia de la acción; se corresponde con los dominios del catálogo de permisos. */
  domain: string;
  /** Qué se hizo, en pasado y en minúsculas: `grant`, `revoke`, `download`. */
  action: string;
  /** Qué clase de objeto se tocó: `user`, `file`, `report`. */
  targetKind?: string;
  /**
   * Parámetro de ruta que identifica al objeto afectado (p. ej. `userId` para
   * `@Delete(':userId/:permissionKey')`).
   *
   * Se nombra el parámetro en vez de leer el cuerpo de la petición a propósito:
   * el cuerpo puede traer datos personales o secretos, y una tabla de auditoría
   * es el último sitio donde deberían acabar por accidente.
   */
  targetParam?: string;
};

/**
 * Marca una ruta administrativa para que quede registrada en `admin.audit_log`.
 *
 * Sigue a `@Roles()` y `@RequirePermission()` en forma y en intención: es
 * declarativo, vive junto al handler y no obliga a inyectar nada en el
 * controlador. El registro ocurre sólo si el handler respondió correctamente —
 * una acción rechazada no es una acción.
 */
export const Audited = (metadata: AuditedMetadata): ReturnType<typeof SetMetadata> =>
  SetMetadata(AUDITED_KEY, metadata);
