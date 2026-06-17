import { Injectable, NotFoundException } from '@nestjs/common';
import { ProfilesRepository } from './profiles.repository';
import { UpsertProfileInput } from './profiles.schemas';

@Injectable()
export class ProfilesService {
  constructor(private readonly profilesRepository: ProfilesRepository) {}

  async getMyProfile(userId: string) {
    const profile = await this.profilesRepository.findByUserId(userId);

    if (!profile) {
      throw new NotFoundException('El perfil antropométrico todavía no fue registrado.');
    }

    return profile;
  }

  upsertMyProfile(userId: string, input: UpsertProfileInput) {
    return this.profilesRepository.upsertByUserId(userId, input);
  }
}
