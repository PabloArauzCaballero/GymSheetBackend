import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Transaction } from 'sequelize';
import { UserRole, UserStatus } from '../../common/enums/domain.enums';
import { UserModel } from './user.model';

export type CreateClientUserInput = {
  email: string;
  passwordHash: string;
  fullName: string;
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
   * Reemplaza el hash de contraseña de una cuenta.
   *
   * Escribe sólo esa columna a propósito: un `save()` del modelo entero
   * arrastraría cualquier campo que el llamante hubiera tocado por el camino,
   * y una operación de seguridad no debe poder cambiar el rol o el estado de
   * la cuenta como efecto secundario.
   */
  async updatePasswordHash(
    userId: string,
    passwordHash: string,
    transaction?: Transaction,
  ): Promise<void> {
    await this.userModel.update({ passwordHash }, { where: { id: userId }, transaction });
  }

  createClient(input: CreateClientUserInput, transaction?: Transaction): Promise<UserModel> {
    return this.userModel.create({
      email: input.email.toLowerCase(),
      passwordHash: input.passwordHash,
      fullName: input.fullName,
    }, { transaction });
  }

  createStaffUser(input: CreateStaffUserInput, transaction?: Transaction): Promise<UserModel> {
    return this.userModel.create({
      email: input.email.toLowerCase(),
      passwordHash: input.passwordHash,
      fullName: input.fullName,
      role: input.role,
    }, { transaction });
  }
}
