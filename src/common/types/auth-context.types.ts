import { UserRole } from '../enums/domain.enums';

/** Authenticated request principal produced by the JWT strategy. */
export type AuthenticatedUser = {
  id: string;
  email: string;
  role: UserRole;
  /**
   * Gimnasio de la cuenta. Sale de la base de datos en cada petición, no del
   * token: si a alguien se le cambia de gimnasio, su sesión abierta debe
   * reflejarlo sin esperar a que el token caduque.
   */
  tenantId: string | null;
};

/** Custom access-token claims controlled by this API. */
export type JwtPayload = {
  sub: string;
  email: string;
  role: UserRole;
};
