import { Body, Controller, Get, Param, Patch, Query } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { UuidParamPipe } from '../../common/pipes/uuid-param.pipe';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { AuthenticatedUser } from '../../common/types/auth-context.types';
import { NotificationService } from './notification.service';
import {
  NotificationListInput,
  UpdateNotificationPreferenceInput,
  notificationListSchema,
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
