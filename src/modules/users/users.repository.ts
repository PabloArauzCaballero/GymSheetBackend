import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { QueryTypes, Transaction } from 'sequelize';
import { FacilityStatus, UserGender, UserRole, UserStatus } from '../../common/enums/domain.enums';
import { BranchModel } from '../facilities/branch.model';
import { UserModel } from './user.model';

export type CreateClientUserInput = {
  email: string;
  passwordHash: string;
  fullName: string;
  /** Gimnasio de la cuenta. Nulo solo en una instalación de una sola marca. */
  tenantId?: string | null;
  gender?: UserGender | null;
  /** `YYYY-MM-DD`, already validated as 18–100. */
  birthDate?: string | null;
  acceptedTermsAt?: Date | null;
  termsVersion?: string | null;
  /** Set at creation only when a provider already vouched for the address. */
  emailVerifiedAt?: Date | null;
  signupRisk?: 'LOW' | 'MEDIUM' | 'HIGH' | null;
};

@Injectable()
export class UsersRepository {
  constructor(
    @InjectModel(UserModel) private readonly userModel: typeof UserModel,
    @InjectModel(BranchModel) private readonly branchModel: typeof BranchModel,
  ) {}

  /** ¿Existe esta sede, activa y dentro del gimnasio indicado? */
  async isActiveBranchInTenant(branchId: string, tenantId: string, transaction?: Transaction): Promise<boolean> {
    const count = await this.branchModel.count({
      where: { id: branchId, tenantId, status: FacilityStatus.ACTIVE },
      transaction,
    });
    return count > 0;
  }

  runInTransaction<T>(work: (transaction: Transaction) => Promise<T>): Promise<T> {
    if (!this.userModel.sequelize) throw new Error("User database connection is unavailable.");
    return this.userModel.sequelize.transaction(work);
  }

  async lockUserForUpdate(userId: string, transaction: Transaction): Promise<void> {
    if (!this.userModel.sequelize) throw new Error("User database connection is unavailable.");
    await this.userModel.sequelize.query("SELECT id FROM public.usuarios WHERE id = :userId FOR UPDATE", {
      replacements: { userId }, transaction,
    });
  }

  findById(userId: string, transaction?: Transaction): Promise<UserModel | null> {
    return this.userModel.findByPk(userId, { transaction });
  }

  findActiveById(userId: string, transaction?: Transaction): Promise<UserModel | null> {
    return this.userModel.findOne({ where: { id: userId, status: UserStatus.ACTIVE }, transaction });
  }

  /** The listing a business account owns, or null (ADR-0020). One primary-key probe. */
  async findBusinessEntityId(userId: string, transaction?: Transaction): Promise<string | null> {
    if (!this.userModel.sequelize) throw new Error("User database connection is unavailable.");
    const [row] = await this.userModel.sequelize.query<{ entity_id: string }>(
      "SELECT entity_id FROM business.accounts WHERE user_id = :userId",
      { replacements: { userId }, type: QueryTypes.SELECT, transaction },
    );
    return row?.entity_id ?? null;
  }

  findByEmail(emailAddress: string, transaction?: Transaction): Promise<UserModel | null> {
    return this.userModel.findOne({ where: { email: emailAddress.toLowerCase() }, transaction });
  }

  findActiveByEmail(emailAddress: string): Promise<UserModel | null> {
    return this.userModel.findOne({ where: { email: emailAddress.toLowerCase(), status: UserStatus.ACTIVE } });
  }

  createClient(input: CreateClientUserInput, transaction?: Transaction): Promise<UserModel> {
    return this.userModel.create({
      email: input.email.toLowerCase(),
      passwordHash: input.passwordHash,
      fullName: input.fullName,
      tenantId: input.tenantId ?? null,
      gender: input.gender ?? null,
      birthDate: input.birthDate ?? null,
      acceptedTermsAt: input.acceptedTermsAt ?? null,
      termsVersion: input.termsVersion ?? null,
      emailVerifiedAt: input.emailVerifiedAt ?? null,
      signupRisk: input.signupRisk ?? null,
    }, { transaction });
  }

  /**
   * A business account (ADR-0020): role NEGOCIO and no person data — the
   * database refuses a birth date or sex on it (ck_usuarios_business_no_person_data).
   */
  createBusiness(
    input: { email: string; passwordHash: string; fullName: string; tenantId: string; signupRisk: 'LOW' | 'MEDIUM' | 'HIGH' },
    transaction: Transaction,
  ): Promise<UserModel> {
    return this.userModel.create({
      email: input.email.toLowerCase(),
      passwordHash: input.passwordHash,
      fullName: input.fullName,
      role: UserRole.BUSINESS,
      tenantId: input.tenantId,
      signupRisk: input.signupRisk,
    }, { transaction });
  }

  /** Idempotent: the first verification timestamp is kept. */
  async markEmailVerified(userId: string, transaction?: Transaction): Promise<void> {
    await this.userModel.update(
      { emailVerifiedAt: new Date() },
      { where: { id: userId, emailVerifiedAt: null }, transaction },
    );
  }

  /**
   * Reemplaza el hash de contraseña de una cuenta.
   *
   * Escribe sólo esa columna a propósito: un `save()` del modelo entero
   * arrastraría cualquier campo que el llamante hubiera tocado por el camino,
   * y una operación de seguridad no debe poder cambiar el rol o el estado de
   * la cuenta como efecto secundario.
   */
  /** Every access token issued before now stops working on its next request. */
  async invalidateIssuedSessions(userId: string, transaction?: Transaction): Promise<void> {
    await this.userModel.update({ sessionsValidAfter: new Date() }, { where: { id: userId }, transaction });
  }

  updatePasswordHash(
    userId: string,
    passwordHash: string,
    transaction?: Transaction,
  ): Promise<[affectedCount: number]> {
    return this.userModel.update({ passwordHash }, { where: { id: userId }, transaction });
  }

  /** Writes only the display name, for the same reason as `updatePasswordHash`. */
  async updateFullName(userId: string, fullName: string, transaction?: Transaction): Promise<void> {
    await this.userModel.update({ fullName }, { where: { id: userId }, transaction });
  }

  /**
   * Swaps the login address of an account whose new mailbox was just proven.
   * Raises `UniqueConstraintError` when another account took it meanwhile.
   */
  async changeEmail(userId: string, email: string, transaction: Transaction): Promise<void> {
    await this.userModel.update(
      { email: email.toLowerCase(), emailVerifiedAt: new Date() },
      { where: { id: userId }, transaction },
    );
  }

  /** Marca cuándo se cerró el último socket de chat activo de esta cuenta. */
  async touchLastSeen(userId: string): Promise<void> {
    await this.userModel.update({ lastSeenAt: new Date() }, { where: { id: userId } });
  }
}
