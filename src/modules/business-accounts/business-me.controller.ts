import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Put,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequiresVerifiedEmail } from '../../common/decorators/requires-verified-email.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../../common/enums/domain.enums';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { AuthenticatedUser } from '../../common/types/auth-context.types';
import { env } from '../../config/env';
import { UploadedSelfie } from '../verification/selfie-image';
import {
  BusinessHandleInput,
  BusinessMediaSlot,
  BusinessProfilePatch,
  businessHandleSchema,
  businessMediaBodySchema,
  businessMediaSlotEnum,
  businessProfilePatchSchema,
} from './business-accounts.schemas';
import { BusinessAccountsService } from './business-accounts.service';

/** The business's own account and listing (ADR-0020). Persons get 403 here. */
@Roles(UserRole.BUSINESS)
@Controller('business/me')
export class BusinessMeController {
  constructor(private readonly service: BusinessAccountsService) {}

  @Get()
  @Header('Cache-Control', 'private, no-store')
  me(@CurrentUser() user: AuthenticatedUser) {
    return this.service.me(user);
  }

  @RequiresVerifiedEmail()
  @Patch('profile')
  updateProfile(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(businessProfilePatchSchema)) patch: BusinessProfilePatch,
  ) {
    return this.service.updateProfile(user, patch);
  }

  @RequiresVerifiedEmail()
  @Put('handle')
  claimHandle(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(businessHandleSchema)) input: BusinessHandleInput,
  ) {
    return this.service.claimHandle(user, input.handle);
  }

  @RequiresVerifiedEmail()
  @Post('media')
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: env.MEDIA_UPLOAD_MAX_BYTES, files: 1 } }))
  uploadMedia(
    @CurrentUser() user: AuthenticatedUser,
    @UploadedFile() file: UploadedSelfie | undefined,
    @Body(new ZodValidationPipe(businessMediaBodySchema)) body: { slot: BusinessMediaSlot },
  ) {
    return this.service.uploadMedia(user, body.slot, file);
  }

  @Delete('media/:slot')
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeMedia(
    @CurrentUser() user: AuthenticatedUser,
    @Param('slot', new ZodValidationPipe(businessMediaSlotEnum)) slot: BusinessMediaSlot,
  ) {
    await this.service.removeMedia(user, slot);
  }
}
