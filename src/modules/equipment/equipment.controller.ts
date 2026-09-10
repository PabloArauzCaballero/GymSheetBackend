import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../../common/enums/domain.enums';
import { UuidParamPipe } from '../../common/pipes/uuid-param.pipe';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { AuthenticatedUser } from '../../common/types/auth-context.types';
import { EquipmentService } from './equipment.service';
import {
  CreateEquipmentInput,
  UpdateEquipmentInput,
  createEquipmentSchema,
  updateEquipmentSchema,
} from './equipment.schemas';

@Controller('equipment')
export class EquipmentController {
  constructor(private readonly equipmentService: EquipmentService) {}

  @Get()
  listAvailableEquipment(@CurrentUser() user: AuthenticatedUser) {
    return this.equipmentService.listAvailableEquipment(user);
  }
}

@Roles(UserRole.ADMIN)
@Controller('admin/equipment')
export class AdminEquipmentController {
  constructor(private readonly equipmentService: EquipmentService) {}

  @Post()
  createEquipment(
    @CurrentUser() actor: AuthenticatedUser,
    @Body(new ZodValidationPipe(createEquipmentSchema)) input: CreateEquipmentInput,
  ) {
    return this.equipmentService.createEquipment(actor, input);
  }

  @Patch(':id')
  updateEquipment(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', UuidParamPipe) equipmentId: string,
    @Body(new ZodValidationPipe(updateEquipmentSchema)) input: UpdateEquipmentInput,
  ) {
    return this.equipmentService.updateEquipment(actor, equipmentId, input);
  }

  @Delete(':id')
  inactivateEquipment(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', UuidParamPipe) equipmentId: string,
  ) {
    return this.equipmentService.inactivateEquipment(actor, equipmentId);
  }
}
