import { UserRole } from '../enums/domain.enums';

/** Authenticated request principal produced by the JWT strategy. */
export type AuthenticatedUser = {
  id: string;
  email: string;
  role: UserRole;
  /**
   * Gimnasio de la cuenta. Nulo en una instalación de una sola marca y en los
   * tokens emitidos antes de existir este campo, que siguen siendo válidos.
   */
  tenantId: string | null;
};

/** Custom access-token claims controlled by this API. */
export type JwtPayload = {
  sub: string;
  email: string;
  role: UserRole;
};
