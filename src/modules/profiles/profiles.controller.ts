import { Body, Controller, Get, Patch, Post } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { AuthenticatedUser } from '../../common/types/auth-context.types';
import { ProfilesService } from './profiles.service';
import { UpsertProfileInput, upsertProfileSchema } from './profiles.schemas';

@Controller('profile')
export class ProfilesController {
  constructor(private readonly profilesService: ProfilesService) {}

  @Get()
  getMyProfile(@CurrentUser() currentUser: AuthenticatedUser) {
    return this.profilesService.getMyProfile(currentUser.id);
  }

  @Post()
  createMyProfile(
    @CurrentUser() currentUser: AuthenticatedUser,
    @Body(new ZodValidationPipe(upsertProfileSchema)) input: UpsertProfileInput,
  ) {
    return this.profilesService.upsertMyProfile(currentUser.id, input);
  }

  @Patch()
  updateMyProfile(
    @CurrentUser() currentUser: AuthenticatedUser,
    @Body(new ZodValidationPipe(upsertProfileSchema)) input: UpsertProfileInput,
  ) {
    return this.profilesService.upsertMyProfile(currentUser.id, input);
  }
}
