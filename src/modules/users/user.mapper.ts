import { UserGender, UserRole, UserStatus } from '../../common/enums/domain.enums';
import { env } from '../../config/env';
import { UserModel } from './user.model';

export type UserResponse = {
  id: string;
  email: string;
  nombreCompleto: string;
  rol: UserRole;
  estado: UserStatus;
  fechaRegistro: Date;
  /** Gimnasio de la cuenta; el cliente pinta su marca a partir de esto. */
  tenantId: string | null;
  /** Nulo = no se ha preguntado todavía. La progresión cae en su rama neutra. */
  genero: UserGender | null;
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
    // Mismo respaldo que en el inicio de sesión: una cuenta anterior al campo
    // no debe verse sin marca en una instalación que sí tiene una.
    tenantId: user.tenantId ?? env.DEFAULT_TENANT_ID ?? null,
    genero: user.gender,
  };
}
