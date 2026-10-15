import { Injectable, NotFoundException, Optional, UnprocessableEntityException } from '@nestjs/common';
import { Transaction } from 'sequelize';
import { effectiveTenantOf } from '../../common/tenancy/tenant-scope';
import { UsersRepository } from './users.repository';
import { UpdateMyAccountInput } from './users.schemas';
import { UserModel } from './user.model';
import { SocialRecommendationOutboxService } from '../social/social-recommendation-outbox.service';

@Injectable()
export class UsersService {
  constructor(
    private readonly usersRepository: UsersRepository,
    @Optional() private readonly recommendationOutbox?: SocialRecommendationOutboxService,
  ) {}

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
    if (!this.recommendationOutbox) {
      const user = await this.getActiveUserOrFail(userId);
      return this.applyAccountUpdate(user, input);
    }
    return this.usersRepository.runInTransaction(async (transaction) => {
      await this.usersRepository.lockUserForUpdate(userId, transaction);
      const user = await this.usersRepository.findActiveById(userId, transaction);
      if (!user) throw new NotFoundException('Usuario no encontrado o inactivo.');
      await this.applyAccountUpdate(user, input, transaction);
      await this.recommendationOutbox!.enqueueProfileSnapshot(userId, transaction);
      return user;
    });
  }

  private async applyAccountUpdate(user: UserModel, input: UpdateMyAccountInput, transaction?: Transaction): Promise<UserModel> {
    if (input.genero !== undefined) {
      if (transaction) await user.update({ gender: input.genero }, { transaction });
      else await user.update({ gender: input.genero });
    }
    if (input.pesoIncrementoKg !== undefined) {
      if (transaction) await user.update({ weightIncrementKg: String(input.pesoIncrementoKg) }, { transaction });
      else await user.update({ weightIncrementKg: String(input.pesoIncrementoKg) });
    }
    if (input.sedeId !== undefined) {
      // La sede se valida contra el gimnasio de la cuenta: elegir una de otro
      // gimnasio sería colarse en su directorio, no escoger dónde entrenas.
      const valid = transaction
        ? await this.usersRepository.isActiveBranchInTenant(input.sedeId, effectiveTenantOf(user), transaction)
        : await this.usersRepository.isActiveBranchInTenant(input.sedeId, effectiveTenantOf(user));
      if (!valid) {
        throw new UnprocessableEntityException('La sede no pertenece a tu gimnasio.');
      }
      if (transaction) await user.update({ branchId: input.sedeId }, { transaction });
      else await user.update({ branchId: input.sedeId });
    }
    return user;
  }
}
