import { UserRole } from '../enums/domain.enums';

/** Authenticated request principal produced by the JWT strategy. */
export type AuthenticatedUser = {
  id: string;
  email: string;
  role: UserRole;
};

/** Minimal access-token claims controlled by this API. */
export type JwtPayload = {
  sub: string;
  email: string;
  role: UserRole;
  iss: string;
  aud: string;
};
