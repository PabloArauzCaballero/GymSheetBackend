import { Injectable, NotFoundException } from '@nestjs/common';
import { UsersRepository } from './users.repository';
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
}
