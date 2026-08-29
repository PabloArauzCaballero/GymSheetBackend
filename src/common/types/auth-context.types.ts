import { UserRole } from '../enums/domain.enums';

/** Authenticated request principal produced by the JWT strategy. */
export type AuthenticatedUser = {
  id: string;
  email: string;
  role: UserRole;
  /**
   * Gimnasio de la cuenta. Siempre resuelto (nunca nulo): las cuentas sin
   * `tenant_id` propio caen en `env.DEFAULT_TENANT_ID`, así el aislamiento
   * entre gimnasios (directorio, conexiones, chat) nunca queda sin filtro.
   *
   * Cuando un `SYSTEM_ADMIN` está suplantando, este es el gimnasio mirado, no
   * el suyo: el dominio de socio no tiene que saber nada de suplantaciones.
   */
  tenantId: string;
  /**
   * Alcance administrativo del principal.
   *
   * - `string`: opera sobre ESE gimnasio y sólo ese. Es el caso de todos los
   *   roles salvo uno, y también el de un `SYSTEM_ADMIN` mientras suplanta.
   * - `null`: sin filtro, todos los gimnasios. Únicamente un `SYSTEM_ADMIN`
   *   que no está suplantando.
   *
   * Se separa de `tenantId` a propósito: «el gimnasio al que pertenezco» y
   * «sobre qué gimnasios puedo operar» dejaron de ser lo mismo al existir un
   * rol supra-inquilino, y colapsarlos en un campo es exactamente cómo se
   * cuela un fallo de aislamiento.
   */
  tenantScope: string | null;
  /** `true` cuando un `SYSTEM_ADMIN` mira un gimnasio concreto vía suplantación. */
  impersonating: boolean;
};

/** Custom access-token claims controlled by this API. */
export type JwtPayload = {
  sub: string;
  email: string;
  role: UserRole;
  /**
   * Gimnasio suplantado. Presente SÓLO en los tokens que emite
   * `POST /auth/impersonate-tenant`, y honrado sólo si la cuenta sigue siendo
   * `SYSTEM_ADMIN` en base de datos al validar: el claim acota un privilegio,
   * nunca lo concede. Un token filtrado con este claim no le sirve de nada a
   * una cuenta que no tenga ya el rol.
   */
  tenantId?: string;
};
