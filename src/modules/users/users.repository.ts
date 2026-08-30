import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Transaction } from 'sequelize';
import { UserGender, UserRole, UserStatus } from '../../common/enums/domain.enums';
import { UserModel } from './user.model';

export type CreateClientUserInput = {
  email: string;
  passwordHash: string;
  fullName: string;
  /** Gimnasio de la cuenta. Nulo solo en una instalación de una sola marca. */
  tenantId?: string | null;
  gender?: UserGender | null;
  acceptedTermsAt?: Date | null;
  termsVersion?: string | null;
};

/**
 * Alta de cuenta con rol laboral. El rol se exige explícito (no hay valor por
 * defecto) porque, a diferencia del alta de cliente, aquí concede permisos.
 */
export type CreateStaffUserInput = CreateClientUserInput & {
  role: UserRole;
};

@Injectable()
export class UsersRepository {
  constructor(@InjectModel(UserModel) private readonly userModel: typeof UserModel) {}

  findById(userId: string, transaction?: Transaction): Promise<UserModel | null> {
    return this.userModel.findByPk(userId, { transaction });
  }

  findActiveById(userId: string): Promise<UserModel | null> {
    return this.userModel.findOne({ where: { id: userId, status: UserStatus.ACTIVE } });
  }

  findByEmail(emailAddress: string, transaction?: Transaction): Promise<UserModel | null> {
    return this.userModel.findOne({ where: { email: emailAddress.toLowerCase() }, transaction });
  }

  findActiveByEmail(emailAddress: string): Promise<UserModel | null> {
    return this.userModel.findOne({ where: { email: emailAddress.toLowerCase(), status: UserStatus.ACTIVE } });
  }

  /**
   * El `ADMIN` activo más antiguo de un tenant. No hay garantía de "exactamente
   * uno por tenant" en este esquema (`tenantId` es solo branding, no una tabla
   * de tenants) — el más antiguo es una elección determinista ante 0 o varios.
   */
  findAdminForTenant(tenantId: string): Promise<UserModel | null> {
    return this.userModel.findOne({
      where: { role: UserRole.ADMIN, tenantId, status: UserStatus.ACTIVE },
      order: [["createdAt", "ASC"]],
    });
  }

  createClient(input: CreateClientUserInput, transaction?: Transaction): Promise<UserModel> {
    return this.userModel.create({
      email: input.email.toLowerCase(),
      passwordHash: input.passwordHash,
      fullName: input.fullName,
      tenantId: input.tenantId ?? null,
      gender: input.gender ?? null,
      acceptedTermsAt: input.acceptedTermsAt ?? null,
      termsVersion: input.termsVersion ?? null,
    }, { transaction });
  }

  createStaffUser(input: CreateStaffUserInput, transaction?: Transaction): Promise<UserModel> {
    return this.userModel.create({
      email: input.email.toLowerCase(),
      passwordHash: input.passwordHash,
      fullName: input.fullName,
      role: input.role,
      tenantId: input.tenantId ?? null,
    }, { transaction });
  }

  updatePasswordHash(
    userId: string,
    passwordHash: string,
    transaction?: Transaction,
  ): Promise<[affectedCount: number]> {
    return this.userModel.update({ passwordHash }, { where: { id: userId }, transaction });
  }

  /** Marca cuándo se cerró el último socket de chat activo de esta cuenta. */
  async touchLastSeen(userId: string): Promise<void> {
    await this.userModel.update({ lastSeenAt: new Date() }, { where: { id: userId } });
  }
}
