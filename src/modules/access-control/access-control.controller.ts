import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../../common/enums/domain.enums';
import { UuidParamPipe } from '../../common/pipes/uuid-param.pipe';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { AuthenticatedUser } from '../../common/types/auth-context.types';
import { AccessControlService } from './access-control.service';
import {
  AccessHistoryFilterInput,
  CreateDeviceInput,
  UpdateDeviceStatusInput,
  accessHistoryFilterSchema,
  createDeviceSchema,
  updateDeviceStatusSchema,
} from './access-control.schemas';

@Controller('access')
export class AccessHistoryController {
  constructor(private readonly service: AccessControlService) {}

  @Get('me')
  getMine(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodValidationPipe(accessHistoryFilterSchema)) query: AccessHistoryFilterInput,
  ) {
    return this.service.listHistory(query, user.id);
  }
}

@Roles(UserRole.ADMIN, UserRole.FRONT_DESK)
@Controller('admin/access')
export class AdminAccessController {
  constructor(private readonly service: AccessControlService) {}

  @Get('devices')
  listDevices() { return this.service.listDevices(); }

  @Post('devices')
  @Roles(UserRole.ADMIN)
  createDevice(@Body(new ZodValidationPipe(createDeviceSchema)) input: CreateDeviceInput) {
    return this.service.createDevice(input);
  }

  @Patch('devices/:id/status')
  @Roles(UserRole.ADMIN)
  updateDeviceStatus(
    @Param('id', UuidParamPipe) id: string,
    @Body(new ZodValidationPipe(updateDeviceStatusSchema)) input: UpdateDeviceStatusInput,
  ) {
    return this.service.updateDeviceStatus(id, input);
  }

  @Get('events/:id')
  getEvent(@Param('id', UuidParamPipe) id: string) { return this.service.getEvent(id); }

  @Get('history')
  listHistory(@Query(new ZodValidationPipe(accessHistoryFilterSchema)) query: AccessHistoryFilterInput) {
    return this.service.listHistory(query);
  }
}
