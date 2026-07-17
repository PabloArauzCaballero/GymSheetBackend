import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../../common/enums/domain.enums';
import { UuidParamPipe } from '../../common/pipes/uuid-param.pipe';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
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
  listAvailableEquipment() {
    return this.equipmentService.listAvailableEquipment();
  }
}

@Roles(UserRole.ADMIN)
@Controller('admin/equipment')
export class AdminEquipmentController {
  constructor(private readonly equipmentService: EquipmentService) {}

  @Post()
  createEquipment(@Body(new ZodValidationPipe(createEquipmentSchema)) input: CreateEquipmentInput) {
    return this.equipmentService.createEquipment(input);
  }

  @Patch(':id')
  updateEquipment(
    @Param('id', UuidParamPipe) equipmentId: string,
    @Body(new ZodValidationPipe(updateEquipmentSchema)) input: UpdateEquipmentInput,
  ) {
    return this.equipmentService.updateEquipment(equipmentId, input);
  }

  @Delete(':id')
  inactivateEquipment(@Param('id', UuidParamPipe) equipmentId: string) {
    return this.equipmentService.inactivateEquipment(equipmentId);
  }
}
