import { Injectable, NotFoundException } from '@nestjs/common';
import { UsersRepository } from './users.repository';
import { UpdateMyAccountInput } from './users.schemas';
import { UserModel } from './user.model';

@Injectable()
export class UsersService {
  constructor(private readonly usersRepository: UsersRepository) {}

  async getActiveUserOrFail(userId: string): Promise<UserModel> {
    const user = await this.usersRepository.findActiveById(userId);

    if (!user) {
      throw new NotFoundException('Usuario no encontrado o inactivo.');
    }

    return user;
  }

  async updateMyAccount(
    userId: string,
    input: UpdateMyAccountInput,
  ): Promise<UserModel> {
    const user = await this.getActiveUserOrFail(userId);
    if (input.genero !== undefined) {
      await user.update({ gender: input.genero });
    }
    if (input.pesoIncrementoKg !== undefined) {
      await user.update({ weightIncrementKg: String(input.pesoIncrementoKg) });
    }
    return user;
  }
}
