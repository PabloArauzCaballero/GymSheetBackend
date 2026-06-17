import { UserRole } from '../enums/domain.enums';

export type AuthenticatedUser = {
  id: string;
  email: string;
  rol: UserRole;
};

export type JwtPayload = {
  sub: string;
  email: string;
  rol: UserRole;
};
