import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { AnthropometricProfileModel } from './anthropometric-profile.model';
import { UpsertProfileInput } from './profiles.schemas';

@Injectable()
export class ProfilesRepository {
  constructor(
    @InjectModel(AnthropometricProfileModel)
    private readonly profileModel: typeof AnthropometricProfileModel,
  ) {}

  findByUserId(userId: string): Promise<AnthropometricProfileModel | null> {
    return this.profileModel.findOne({ where: { userId } });
  }

  async upsertByUserId(
    userId: string,
    input: UpsertProfileInput,
  ): Promise<AnthropometricProfileModel> {
    const existingProfile = await this.findByUserId(userId);

    if (existingProfile) {
      await existingProfile.update({
        age: input.age,
        weightKg: input.weightKg,
        heightCm: input.heightCm,
        goal: input.goal,
        measurementUpdatedAt: new Date(),
      });
      return existingProfile;
    }

    return this.profileModel.create({
      userId,
      age: input.age,
      weightKg: input.weightKg,
      heightCm: input.heightCm,
      goal: input.goal,
    });
  }
}
