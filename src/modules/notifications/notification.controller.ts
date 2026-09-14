import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { UuidParamPipe } from '../../common/pipes/uuid-param.pipe';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { AuthenticatedUser } from '../../common/types/auth-context.types';
import { NotificationService } from './notification.service';
import { DeviceTokenService } from './device-token.service';
import {
  RegisterDeviceTokenInput,
  UnregisterDeviceTokenInput,
  registerDeviceTokenSchema,
  unregisterDeviceTokenSchema,
} from './device-token.schemas';
import {
  NotificationListInput,
  UpdateNotificationPreferenceInput,
  notificationListSchema,
  updateNotificationPreferenceSchema,
} from './notifications.schemas';

@Controller('notifications')
export class NotificationController {
  constructor(
    private readonly service: NotificationService,
    private readonly deviceTokens: DeviceTokenService,
  ) {}

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

  // Lo primero que consulta el navegador antes de ofrecer el botón de activar:
  // si este despliegue hace push web y con qué `applicationServerKey`. Requiere
  // sesión como el resto del controlador — no es un secreto, pero tampoco hace
  // falta publicarlo a quien no ha entrado.
  @Get('push/web-config')
  getWebPushConfig() {
    return this.deviceTokens.webPushConfig();
  }

  // 200 con un cuerpo chico, no 204: el interceptor global de respuesta siempre envuelve en
  // `{ ok, data }`, y el cliente del móvil hace `response.json()` sin condicionar por status —
  // un 204 de verdad (sin cuerpo) le rompería el parseo.
  @Post('device-tokens')
  async registerDeviceToken(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(registerDeviceTokenSchema)) input: RegisterDeviceTokenInput,
  ) {
    await this.deviceTokens.register(user.id, input);
    return { registered: true } as const;
  }

  @Delete('device-tokens')
  async unregisterDeviceToken(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(unregisterDeviceTokenSchema)) input: UnregisterDeviceTokenInput,
  ) {
    await this.deviceTokens.unregister(user.id, input);
    return { registered: false } as const;
  }
}
