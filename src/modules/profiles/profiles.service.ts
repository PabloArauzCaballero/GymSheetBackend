import { Injectable, NotFoundException } from '@nestjs/common';
import { AnthropometricProfileResponse, mapProfileToResponse } from './profile.mapper';
import { ProfilesRepository } from './profiles.repository';
import { UpsertProfileInput } from './profiles.schemas';

@Injectable()
export class ProfilesService {
  constructor(private readonly profilesRepository: ProfilesRepository) {}

  async getMyProfile(userId: string): Promise<AnthropometricProfileResponse> {
    const profile = await this.profilesRepository.findByUserId(userId);

    if (!profile) {
      throw new NotFoundException('El perfil antropométrico todavía no fue registrado.');
    }

    return mapProfileToResponse(profile);
  }

  async upsertMyProfile(
    userId: string,
    input: UpsertProfileInput,
  ): Promise<AnthropometricProfileResponse> {
    const profile = await this.profilesRepository.upsertByUserId(userId, input);
    return mapProfileToResponse(profile);
  }
}
