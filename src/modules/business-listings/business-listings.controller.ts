import { Body, Controller, Delete, Get, Header, HttpCode, HttpStatus, Param, Patch, Post, Query, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequiresVerifiedEmail } from '../../common/decorators/requires-verified-email.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../../common/enums/domain.enums';
import { UuidParamPipe } from '../../common/pipes/uuid-param.pipe';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { AuthenticatedUser } from '../../common/types/auth-context.types';
import { env } from '../../config/env';
import { UploadedSelfie } from '../verification/selfie-image';
import {
  CreateListingInput,
  ListingPriceInput,
  ListingStockInput,
  OwnListingsQuery,
  UpdateListingInput,
  createListingSchema,
  listingMediaPositionSchema,
  listingPriceSchema,
  listingStockSchema,
  ownListingsQuerySchema,
  updateListingSchema,
} from './business-listings.schemas';
import { BusinessListingsService } from './business-listings.service';
import { ListingMediaService } from './listing-media.service';

/** The business's own listings (ADR-0022). Persons get 403; another business's listing is 404. */
@Roles(UserRole.BUSINESS)
@Controller('business/me/listings')
export class BusinessListingsController {
  constructor(
    private readonly listings: BusinessListingsService,
    private readonly media: ListingMediaService,
  ) {}

  @Get()
  @Header('Cache-Control', 'private, no-store')
  list(@CurrentUser() user: AuthenticatedUser, @Query(new ZodValidationPipe(ownListingsQuerySchema)) query: OwnListingsQuery) {
    return this.listings.list(user, query);
  }

  @RequiresVerifiedEmail()
  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@CurrentUser() user: AuthenticatedUser, @Body(new ZodValidationPipe(createListingSchema)) input: CreateListingInput) {
    return this.listings.create(user, input);
  }

  @Get(':id')
  @Header('Cache-Control', 'private, no-store')
  get(@CurrentUser() user: AuthenticatedUser, @Param('id', UuidParamPipe) id: string) {
    return this.listings.get(user, id);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', UuidParamPipe) id: string,
    @Body(new ZodValidationPipe(updateListingSchema)) patch: UpdateListingInput,
  ) {
    return this.listings.update(user, id, patch);
  }

  @Patch(':id/price')
  price(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', UuidParamPipe) id: string,
    @Body(new ZodValidationPipe(listingPriceSchema)) input: ListingPriceInput,
  ) {
    return this.listings.changePrice(user, id, input);
  }

  @Patch(':id/stock')
  stock(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', UuidParamPipe) id: string,
    @Body(new ZodValidationPipe(listingStockSchema)) input: ListingStockInput,
  ) {
    return this.listings.changeStock(user, id, input);
  }

  @Post(':id/pause')
  @HttpCode(HttpStatus.OK)
  pause(@CurrentUser() user: AuthenticatedUser, @Param('id', UuidParamPipe) id: string) {
    return this.listings.transition(user, id, 'pause');
  }

  @Post(':id/resume')
  @HttpCode(HttpStatus.OK)
  resume(@CurrentUser() user: AuthenticatedUser, @Param('id', UuidParamPipe) id: string) {
    return this.listings.transition(user, id, 'resume');
  }

  @Post(':id/archive')
  @HttpCode(HttpStatus.OK)
  archive(@CurrentUser() user: AuthenticatedUser, @Param('id', UuidParamPipe) id: string) {
    return this.listings.transition(user, id, 'archive');
  }

  @RequiresVerifiedEmail()
  @Post(':id/media')
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: env.MEDIA_UPLOAD_MAX_BYTES, files: 1 } }))
  addMedia(@CurrentUser() user: AuthenticatedUser, @Param('id', UuidParamPipe) id: string, @UploadedFile() file: UploadedSelfie | undefined) {
    return this.media.add(user, id, file);
  }

  @Delete(':id/media/:position')
  removeMedia(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', UuidParamPipe) id: string,
    @Param('position', new ZodValidationPipe(listingMediaPositionSchema)) position: number,
  ) {
    return this.media.remove(user, id, position);
  }
}
