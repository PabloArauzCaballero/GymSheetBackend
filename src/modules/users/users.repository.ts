import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { UserStatus } from '../../common/enums/domain.enums';
import { UserModel } from './user.model';

@Injectable()
export class UsersRepository {
  constructor(@InjectModel(UserModel) private readonly userModel: typeof UserModel) {}

  findById(id: string): Promise<UserModel | null> {
    return this.userModel.findByPk(id);
  }

  findActiveById(id: string): Promise<UserModel | null> {
    return this.userModel.findOne({ where: { id, estado: UserStatus.ACTIVO } });
  }

  findByEmail(email: string): Promise<UserModel | null> {
    return this.userModel.findOne({ where: { email: email.toLowerCase() } });
  }

  createCliente(input: { email: string; passwordHash: string; nombreCompleto: string }): Promise<UserModel> {
    return this.userModel.create({
      email: input.email.toLowerCase(),
      passwordHash: input.passwordHash,
      nombreCompleto: input.nombreCompleto,
    });
  }
}
