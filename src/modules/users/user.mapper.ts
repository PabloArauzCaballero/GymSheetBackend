import { UserRole, UserStatus } from '../../common/enums/domain.enums';
import { UserModel } from './user.model';

export type UserResponse = {
  id: string;
  email: string;
  nombreCompleto: string;
  rol: UserRole;
  estado: UserStatus;
  fechaRegistro: Date;
};

/**
 * Maps the persistence model to the established v1 API contract.
 * Internal identifiers stay in English while response fields remain compatible.
 */
export function mapUserToResponse(user: UserModel): UserResponse {
  return {
    id: user.id,
    email: user.email,
    nombreCompleto: user.fullName,
    rol: user.role,
    estado: user.status,
    fechaRegistro: user.registeredAt,
  };
}
