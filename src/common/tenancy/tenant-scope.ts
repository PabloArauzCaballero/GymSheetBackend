/**
 * Traducción única de un alcance de gimnasio a cláusula `where`.
 *
 * Existe para que el filtro se escriba de una sola forma en todo `admin/*`. El
 * defecto que cierra (H-02) no fue un filtro mal escrito: fue que no había
 * ninguno en cincuenta endpoints, y la forma de que eso vuelva a pasar es que
 * cada repositorio invente su propia versión y una se quede a medias.
 *
 * `null` significa «todos los gimnasios» y sólo lo alcanza un `SYSTEM_ADMIN`
 * que no está suplantando (ver `AuthenticatedUser.tenantScope`). Cualquier otro
 * principal llega aquí con un identificador concreto.
 */
export function tenantScopeWhere(
  tenantScope: string | null,
): Record<string, string> {
  return tenantScope === null ? {} : { tenantId: tenantScope };
}
