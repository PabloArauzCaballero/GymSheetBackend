import { Body, Controller, Delete, Get, Header, HttpCode, HttpStatus, Param, Patch, Post } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../../common/enums/domain.enums';
import { UuidParamPipe } from '../../common/pipes/uuid-param.pipe';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { AuthenticatedUser } from '../../common/types/auth-context.types';
import { CreateLocationInput, UpdateLocationInput, createLocationSchema, updateLocationSchema } from './business-listings.schemas';
import { BusinessLocationsService } from './business-locations.service';

/** The business's declared locations (ADR-0022, plan §2.3). Another business's location is 404. */
@Roles(UserRole.BUSINESS)
@Controller('business/me/locations')
export class BusinessLocationsController {
  constructor(private readonly locations: BusinessLocationsService) {}

  @Get()
  @Header('Cache-Control', 'private, no-store')
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.locations.list(user);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@CurrentUser() user: AuthenticatedUser, @Body(new ZodValidationPipe(createLocationSchema)) input: CreateLocationInput) {
    return this.locations.create(user, input);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', UuidParamPipe) id: string,
    @Body(new ZodValidationPipe(updateLocationSchema)) patch: UpdateLocationInput,
  ) {
    return this.locations.update(user, id, patch);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@CurrentUser() user: AuthenticatedUser, @Param('id', UuidParamPipe) id: string) {
    await this.locations.remove(user, id);
  }
}
