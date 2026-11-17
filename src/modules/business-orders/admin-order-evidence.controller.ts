import { Controller, Get, Header, NotFoundException, Param, Req, StreamableFile } from '@nestjs/common';
import type { Request } from 'express';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { UuidParamPipe } from '../../common/pipes/uuid-param.pipe';
import { PLATFORM_MODERATION_ROLES } from '../../common/tenancy/tenant-scope';
import { AuthenticatedUser } from '../../common/types/auth-context.types';
import { AuditLogService } from '../admin-access/audit-log.service';
import { requestTrace } from '../business-kyc/admin-business-kyc.controller';
import { ModerationTargetKind } from '../moderation/moderation.policy';
import { ModerationService } from '../moderation/moderation.service';
import { OrderPaymentService } from './order-payment.service';
import { OrdersRepository } from './orders.repository';

/**
 * REPP sees a receipt only as evidence of a `PAYMENT_ORDER` case (ADR-0024):
 * the case must exist and the moderator must be allowed to read it (ADR-0018
 * §8, the same gate as the case file). Every view leaves its audit row before
 * the bytes go out. REPP has no other door to an order and decides nothing
 * about its payment.
 */
@Roles(...PLATFORM_MODERATION_ROLES)
@Controller('admin/moderation/cases/PAYMENT_ORDER')
export class AdminOrderEvidenceController {
  constructor(
    private readonly moderation: ModerationService,
    private readonly orders: OrdersRepository,
    private readonly payment: OrderPaymentService,
    private readonly auditLog: AuditLogService,
  ) {}

  @Get(':orderId/receipt')
  @Header('Cache-Control', 'private, no-store')
  @Header('X-Content-Type-Options', 'nosniff')
  async receipt(@CurrentUser() actor: AuthenticatedUser, @Param('orderId', UuidParamPipe) orderId: string, @Req() request: Request): Promise<StreamableFile> {
    await this.moderation.getCase(actor, ModerationTargetKind.PAYMENT_ORDER, orderId);
    const order = await this.orders.findOrder(orderId);
    if (!order) throw new NotFoundException('Comprobante no encontrado.');
    const media = await this.payment.readReceipt(order);
    await this.auditLog.record(actor, {
      domain: 'moderation',
      action: 'payment-order-receipt-view',
      targetKind: 'payment_order',
      targetId: orderId,
      metadata: { receiptSha256: order.receiptSha256 },
      ...requestTrace(request),
    });
    return new StreamableFile(media.buffer, { type: media.mimeType, disposition: 'inline' });
  }
}
