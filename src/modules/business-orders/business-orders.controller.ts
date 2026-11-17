import { Body, Controller, Get, Header, HttpCode, HttpStatus, Param, Post, Put, Query, StreamableFile, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../../common/enums/domain.enums';
import { UuidParamPipe } from '../../common/pipes/uuid-param.pipe';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { AuthenticatedUser } from '../../common/types/auth-context.types';
import { env } from '../../config/env';
import { UploadedSelfie } from '../verification/selfie-image';
import {
  ConfirmOrderInput,
  OrderListQuery,
  PaymentConfigInput,
  RejectOrderInput,
  confirmOrderSchema,
  orderListQuerySchema,
  paymentConfigSchema,
  rejectOrderSchema,
} from './business-orders.schemas';
import { BusinessOrdersService } from './business-orders.service';
import { PaymentConfigService } from './payment-config.service';

/**
 * The business's inbox (ADR-0024). Only `NEGOCIO`: a person, a moderator or
 * the platform admin gets 403 (REPP never confirms a payment, D9); another
 * business's order is 404.
 */
@Roles(UserRole.BUSINESS)
@Controller('business/me/orders')
export class BusinessOrdersController {
  constructor(private readonly orders: BusinessOrdersService) {}

  @Get()
  @Header('Cache-Control', 'private, no-store')
  list(@CurrentUser() actor: AuthenticatedUser, @Query(new ZodValidationPipe(orderListQuerySchema)) query: OrderListQuery) {
    return this.orders.list(actor, query);
  }

  @Get(':id')
  @Header('Cache-Control', 'private, no-store')
  get(@CurrentUser() actor: AuthenticatedUser, @Param('id', UuidParamPipe) id: string) {
    return this.orders.get(actor, id);
  }

  @Get(':id/receipt')
  @Header('Cache-Control', 'private, no-store')
  @Header('X-Content-Type-Options', 'nosniff')
  async receipt(@CurrentUser() actor: AuthenticatedUser, @Param('id', UuidParamPipe) id: string): Promise<StreamableFile> {
    const media = await this.orders.receipt(actor, id);
    return new StreamableFile(media.buffer, { type: media.mimeType, disposition: 'inline' });
  }

  @Post(':id/confirm')
  @HttpCode(HttpStatus.OK)
  confirm(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', UuidParamPipe) id: string,
    @Body(new ZodValidationPipe(confirmOrderSchema)) input: ConfirmOrderInput,
  ) {
    return this.orders.confirm(actor, id, input);
  }

  @Post(':id/reject')
  @HttpCode(HttpStatus.OK)
  reject(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', UuidParamPipe) id: string,
    @Body(new ZodValidationPipe(rejectOrderSchema)) input: RejectOrderInput,
  ) {
    return this.orders.reject(actor, id, input);
  }
}

/** How the business is paid (ADR-0024): private, only its own; the QR is an uploaded file. */
@Roles(UserRole.BUSINESS)
@Controller('business/me/payment-config')
export class PaymentConfigController {
  constructor(private readonly config: PaymentConfigService) {}

  @Get()
  @Header('Cache-Control', 'private, no-store')
  get(@CurrentUser() actor: AuthenticatedUser) {
    return this.config.get(actor);
  }

  @Put()
  save(@CurrentUser() actor: AuthenticatedUser, @Body(new ZodValidationPipe(paymentConfigSchema)) input: PaymentConfigInput) {
    return this.config.save(actor, input);
  }

  @Put('qr')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: env.MEDIA_UPLOAD_MAX_BYTES, files: 1 } }))
  uploadQr(@CurrentUser() actor: AuthenticatedUser, @UploadedFile() file: UploadedSelfie | undefined) {
    return this.config.uploadQr(actor, file);
  }

  @Get('qr')
  @Header('Cache-Control', 'private, no-store')
  @Header('X-Content-Type-Options', 'nosniff')
  async qr(@CurrentUser() actor: AuthenticatedUser): Promise<StreamableFile> {
    const media = await this.config.qr(actor);
    return new StreamableFile(media.buffer, { type: media.mimeType, disposition: 'inline' });
  }
}
