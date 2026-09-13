import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { UuidParamPipe } from '../../common/pipes/uuid-param.pipe';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { AuthenticatedUser } from '../../common/types/auth-context.types';
import { NotificationService } from './notification.service';
import {
  NotificationListInput,
  RegisterDeviceTokenInput,
  UnregisterDeviceTokenInput,
  UpdateNotificationPreferenceInput,
  notificationListSchema,
  registerDeviceTokenSchema,
  unregisterDeviceTokenSchema,
  updateNotificationPreferenceSchema,
} from './notifications.schemas';

@Controller('notifications')
export class NotificationController {
  constructor(private readonly service: NotificationService) {}

  @Get('me')
  listMine(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodValidationPipe(notificationListSchema)) filters: NotificationListInput,
  ) {
    return this.service.listMine(user.id, filters);
  }

  @Patch(':id/read')
  markRead(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', UuidParamPipe) id: string,
  ) {
    return this.service.markMineRead(user.id, id);
  }

  /**
   * El dispositivo se registra a nombre de quien trae la sesión, nunca de un
   * `userId` del cuerpo: si el destinatario fuese un parámetro, cualquiera con
   * cuenta podría suscribir su teléfono a los avisos de otra persona.
   */
  @Post('device-tokens')
  registerDeviceToken(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(registerDeviceTokenSchema))
    input: RegisterDeviceTokenInput,
  ) {
    return this.service.registerDeviceToken(user.id, input);
  }

  @Delete('device-tokens')
  unregisterDeviceToken(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(unregisterDeviceTokenSchema))
    input: UnregisterDeviceTokenInput,
  ) {
    return this.service.unregisterDeviceToken(user.id, input);
  }

  @Get('preferences/me')
  getPreference(@CurrentUser() user: AuthenticatedUser) {
    return this.service.getMyPreference(user.id);
  }

  @Patch('preferences/me')
  updatePreference(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(updateNotificationPreferenceSchema))
    input: UpdateNotificationPreferenceInput,
  ) {
    return this.service.updateMyPreference(user.id, input);
  }
}
