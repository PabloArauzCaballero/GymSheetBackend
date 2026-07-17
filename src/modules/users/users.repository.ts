import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { UserStatus } from '../../common/enums/domain.enums';
import { UserModel } from './user.model';

export type CreateClientUserInput = {
  email: string;
  passwordHash: string;
  fullName: string;
};

@Injectable()
export class UsersRepository {
  constructor(@InjectModel(UserModel) private readonly userModel: typeof UserModel) {}

  findById(userId: string): Promise<UserModel | null> {
    return this.userModel.findByPk(userId);
  }

  findActiveById(userId: string): Promise<UserModel | null> {
    return this.userModel.findOne({
      where: { id: userId, status: UserStatus.ACTIVO },
    });
  }

  findByEmail(emailAddress: string): Promise<UserModel | null> {
    return this.userModel.findOne({
      where: { email: emailAddress.toLowerCase() },
    });
  }

  findActiveByEmail(emailAddress: string): Promise<UserModel | null> {
    return this.userModel.findOne({
      where: {
        email: emailAddress.toLowerCase(),
        status: UserStatus.ACTIVO,
      },
    });
  }

  createClient(input: CreateClientUserInput): Promise<UserModel> {
    return this.userModel.create({
      email: input.email.toLowerCase(),
      passwordHash: input.passwordHash,
      fullName: input.fullName,
    });
  }
}
