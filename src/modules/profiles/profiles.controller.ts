import { Body, Controller, Get, Patch, Post } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { AuthenticatedUser } from '../../common/types/auth-context.types';
import { AnthropometricProfileResponse } from './profile.mapper';
import { ProfilesService } from './profiles.service';
import { UpsertProfileInput, upsertProfileSchema } from './profiles.schemas';

@Controller('profile')
export class ProfilesController {
  constructor(private readonly profilesService: ProfilesService) {}

  @Get()
  getMyProfile(
    @CurrentUser() authenticatedUser: AuthenticatedUser,
  ): Promise<AnthropometricProfileResponse> {
    return this.profilesService.getMyProfile(authenticatedUser.id);
  }

  @Post()
  createMyProfile(
    @CurrentUser() authenticatedUser: AuthenticatedUser,
    @Body(new ZodValidationPipe(upsertProfileSchema)) input: UpsertProfileInput,
  ): Promise<AnthropometricProfileResponse> {
    return this.profilesService.upsertMyProfile(authenticatedUser.id, input);
  }

  @Patch()
  updateMyProfile(
    @CurrentUser() authenticatedUser: AuthenticatedUser,
    @Body(new ZodValidationPipe(upsertProfileSchema)) input: UpsertProfileInput,
  ): Promise<AnthropometricProfileResponse> {
    return this.profilesService.upsertMyProfile(authenticatedUser.id, input);
  }
}
