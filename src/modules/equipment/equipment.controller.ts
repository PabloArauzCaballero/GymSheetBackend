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
  seedEquipmentFromCatalogSchema,
  type SeedEquipmentFromCatalogInput,
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

  /**
   * El catálogo sugerido, agrupado por zona.
   *
   * Se sirve desde el código y no desde la base: es una lista curada que
   * cambia con la aplicación, no un dato que cada gimnasio edite. Lo que sí
   * edita es su propio equipamiento, una vez copiado.
   */
  @Get("catalog")
  listCatalog() {
    return this.equipmentService.listCatalog();
  }

  /** Copia al gimnasio las máquinas que eligió del catálogo. */
  @Post("catalog")
  seedFromCatalog(
    @Body(new ZodValidationPipe(seedEquipmentFromCatalogSchema))
    input: SeedEquipmentFromCatalogInput,
  ) {
    return this.equipmentService.seedFromCatalog(input.claves);
  }

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
