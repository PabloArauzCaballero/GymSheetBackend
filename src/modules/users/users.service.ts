import { Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { effectiveTenantOf } from '../../common/tenancy/tenant-scope';
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
    if (input.sedeId !== undefined) {
      // La sede se valida contra el gimnasio de la cuenta: elegir una de otro
      // gimnasio sería colarse en su directorio, no escoger dónde entrenas.
      const valid = await this.usersRepository.isActiveBranchInTenant(
        input.sedeId,
        effectiveTenantOf(user),
      );
      if (!valid) {
        throw new UnprocessableEntityException('La sede no pertenece a tu gimnasio.');
      }
      await user.update({ branchId: input.sedeId });
    }
    return user;
  }
}
