import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../../common/enums/domain.enums';
import { UuidParamPipe } from '../../common/pipes/uuid-param.pipe';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { AuthenticatedUser } from '../../common/types/auth-context.types';
import { FacilitiesService } from './facilities.service';
import {
  AssignEquipmentInput,
  CompleteMaintenanceInput,
  CreateAccessPointInput,
  CreateBranchInput,
  CreateRoomInput,
  MaintenanceFilterInput,
  PaginationInput,
  ScheduleMaintenanceInput,
  UpdateAccessPointInput,
  UpdateBranchInput,
  UpdateRoomInput,
  assignEquipmentSchema,
  completeMaintenanceSchema,
  createAccessPointSchema,
  createBranchSchema,
  createRoomSchema,
  maintenanceFilterSchema,
  paginationSchema,
  scheduleMaintenanceSchema,
  updateAccessPointSchema,
  updateBranchSchema,
  updateRoomSchema,
} from './facilities.schemas';

@Roles(UserRole.ADMIN, UserRole.FRONT_DESK)
@Controller('admin/facilities')
export class FacilitiesController {
  constructor(private readonly service: FacilitiesService) {}

  @Get('branches')
  listBranches(
    @CurrentUser() actor: AuthenticatedUser,
    @Query(new ZodValidationPipe(paginationSchema)) query: PaginationInput,
  ) {
    return this.service.listBranches(actor, query);
  }

  @Post('branches')
  @Roles(UserRole.ADMIN)
  createBranch(
    @CurrentUser() actor: AuthenticatedUser,
    @Body(new ZodValidationPipe(createBranchSchema)) input: CreateBranchInput,
  ) {
    return this.service.createBranch(actor, input);
  }

  @Patch('branches/:id')
  @Roles(UserRole.ADMIN)
  updateBranch(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', UuidParamPipe) id: string,
    @Body(new ZodValidationPipe(updateBranchSchema)) input: UpdateBranchInput,
  ) {
    return this.service.updateBranch(actor, id, input);
  }

  @Delete('branches/:id')
  @Roles(UserRole.ADMIN)
  deactivateBranch(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', UuidParamPipe) id: string,
  ) {
    return this.service.deactivateBranch(actor, id);
  }

  @Get('rooms')
  listRooms(
    @CurrentUser() actor: AuthenticatedUser,
    @Query('branchId') branchId: string | undefined,
    @Query(new ZodValidationPipe(paginationSchema)) query: PaginationInput,
  ) {
    return this.service.listRooms(actor, branchId, query);
  }

  @Post('rooms')
  @Roles(UserRole.ADMIN)
  createRoom(
    @CurrentUser() actor: AuthenticatedUser,
    @Body(new ZodValidationPipe(createRoomSchema)) input: CreateRoomInput,
  ) {
    return this.service.createRoom(actor, input);
  }

  @Patch('rooms/:id')
  @Roles(UserRole.ADMIN)
  updateRoom(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', UuidParamPipe) id: string,
    @Body(new ZodValidationPipe(updateRoomSchema)) input: UpdateRoomInput,
  ) {
    return this.service.updateRoom(actor, id, input);
  }

  @Delete('rooms/:id')
  @Roles(UserRole.ADMIN)
  deactivateRoom(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', UuidParamPipe) id: string,
  ) {
    return this.service.deactivateRoom(actor, id);
  }

  @Get('access-points')
  listAccessPoints(
    @CurrentUser() actor: AuthenticatedUser,
    @Query('branchId') branchId?: string,
  ) {
    return this.service.listAccessPoints(actor, branchId);
  }

  @Post('access-points')
  @Roles(UserRole.ADMIN)
  createAccessPoint(
    @CurrentUser() actor: AuthenticatedUser,
    @Body(new ZodValidationPipe(createAccessPointSchema))
    input: CreateAccessPointInput,
  ) {
    return this.service.createAccessPoint(actor, input);
  }

  @Patch('access-points/:id')
  @Roles(UserRole.ADMIN)
  updateAccessPoint(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', UuidParamPipe) id: string,
    @Body(new ZodValidationPipe(updateAccessPointSchema))
    input: UpdateAccessPointInput,
  ) {
    return this.service.updateAccessPoint(actor, id, input);
  }

  @Delete('access-points/:id')
  @Roles(UserRole.ADMIN)
  deactivateAccessPoint(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', UuidParamPipe) id: string,
  ) {
    return this.service.deactivateAccessPoint(actor, id);
  }

  @Post('equipment-assignments')
  @Roles(UserRole.ADMIN)
  assignEquipment(
    @CurrentUser() actor: AuthenticatedUser,
    @Body(new ZodValidationPipe(assignEquipmentSchema))
    input: AssignEquipmentInput,
  ) {
    return this.service.assignEquipment(actor, input);
  }

  @Get('maintenance')
  listMaintenance(
    @CurrentUser() actor: AuthenticatedUser,
    @Query(new ZodValidationPipe(maintenanceFilterSchema))
    query: MaintenanceFilterInput,
  ) {
    return this.service.listMaintenance(actor, query);
  }

  @Post('maintenance')
  scheduleMaintenance(
    @CurrentUser() actor: AuthenticatedUser,
    @Body(new ZodValidationPipe(scheduleMaintenanceSchema))
    input: ScheduleMaintenanceInput,
  ) {
    return this.service.scheduleMaintenance(actor, input);
  }

  @Patch('maintenance/:id/start')
  startMaintenance(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', UuidParamPipe) id: string,
  ) {
    return this.service.startMaintenance(actor, id);
  }

  @Patch('maintenance/:id/complete')
  completeMaintenance(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', UuidParamPipe) id: string,
    @Body(new ZodValidationPipe(completeMaintenanceSchema))
    input: CompleteMaintenanceInput,
  ) {
    return this.service.completeMaintenance(actor, id, input);
  }
}
