import { UserRole } from "../enums/domain.enums";
import { env } from "../../config/env";

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

/**
 * Gimnasio efectivo de una cuenta.
 *
 * `usuarios.tenant_id` admite nulo: las cuentas anteriores a la multi-marca no
 * lo tienen y caen en el gimnasio de referencia. Resolverlo en un solo sitio
 * evita que unas comprobaciones traten el nulo como «el de por defecto» y otras
 * como «ninguno», que es una discrepancia que sólo se nota cuando el
 * administrador del gimnasio por defecto deja de ver a sus socios más antiguos.
 */
export function effectiveTenantOf(account: { tenantId: string | null }): string {
  return account.tenantId ?? env.DEFAULT_TENANT_ID;
}

/** ¿Cae esta cuenta dentro del alcance? `null` alcanza a todas. */
export function isAccountInScope(
  account: { tenantId: string | null },
  tenantScope: string | null,
): boolean {
  return tenantScope === null || effectiveTenantOf(account) === tenantScope;
}

/**
 * Roles that run the social moderation of the platform (ADR-0018): the central
 * REPP team (`MODERATOR`) and the platform administrator. Gym staff is never
 * part of it, whatever permissions it holds.
 */
export const PLATFORM_MODERATION_ROLES: readonly UserRole[] = [UserRole.MODERATOR, UserRole.SYSTEM_ADMIN];

/**
 * Scope a platform role acts on.
 *
 * A `MODERATOR` keeps its own gym in `tenantScope` (it is still a member there
 * and every member route must stay bound to it), but on the platform surfaces
 * it moderates every gym: those surfaces, and the audit rows they write, read
 * the scope through this function. Every other principal keeps its own scope,
 * so a SYSTEM_ADMIN impersonating a gym still sees only that gym.
 */
export function platformScopeOf(actor: { role: UserRole; tenantScope: string | null }): string | null {
  return actor.role === UserRole.MODERATOR ? null : actor.tenantScope;
}
