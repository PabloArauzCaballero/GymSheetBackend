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
    @Query(new ZodValidationPipe(paginationSchema)) query: PaginationInput,
  ) {
    return this.service.listBranches(query);
  }

  @Post('branches')
  @Roles(UserRole.ADMIN)
  createBranch(
    @Body(new ZodValidationPipe(createBranchSchema)) input: CreateBranchInput,
  ) {
    return this.service.createBranch(input);
  }

  @Patch('branches/:id')
  @Roles(UserRole.ADMIN)
  updateBranch(
    @Param('id', UuidParamPipe) id: string,
    @Body(new ZodValidationPipe(updateBranchSchema)) input: UpdateBranchInput,
  ) {
    return this.service.updateBranch(id, input);
  }

  @Delete('branches/:id')
  @Roles(UserRole.ADMIN)
  deactivateBranch(@Param('id', UuidParamPipe) id: string) {
    return this.service.deactivateBranch(id);
  }

  @Get('rooms')
  listRooms(
    @Query('branchId') branchId: string | undefined,
    @Query(new ZodValidationPipe(paginationSchema)) query: PaginationInput,
  ) {
    return this.service.listRooms(branchId, query);
  }

  @Post('rooms')
  @Roles(UserRole.ADMIN)
  createRoom(
    @Body(new ZodValidationPipe(createRoomSchema)) input: CreateRoomInput,
  ) {
    return this.service.createRoom(input);
  }

  @Patch('rooms/:id')
  @Roles(UserRole.ADMIN)
  updateRoom(
    @Param('id', UuidParamPipe) id: string,
    @Body(new ZodValidationPipe(updateRoomSchema)) input: UpdateRoomInput,
  ) {
    return this.service.updateRoom(id, input);
  }

  @Delete('rooms/:id')
  @Roles(UserRole.ADMIN)
  deactivateRoom(@Param('id', UuidParamPipe) id: string) {
    return this.service.deactivateRoom(id);
  }

  @Get('access-points')
  listAccessPoints(@Query('branchId') branchId?: string) {
    return this.service.listAccessPoints(branchId);
  }

  @Post('access-points')
  @Roles(UserRole.ADMIN)
  createAccessPoint(
    @Body(new ZodValidationPipe(createAccessPointSchema))
    input: CreateAccessPointInput,
  ) {
    return this.service.createAccessPoint(input);
  }

  @Patch('access-points/:id')
  @Roles(UserRole.ADMIN)
  updateAccessPoint(
    @Param('id', UuidParamPipe) id: string,
    @Body(new ZodValidationPipe(updateAccessPointSchema))
    input: UpdateAccessPointInput,
  ) {
    return this.service.updateAccessPoint(id, input);
  }

  @Delete('access-points/:id')
  @Roles(UserRole.ADMIN)
  deactivateAccessPoint(@Param('id', UuidParamPipe) id: string) {
    return this.service.deactivateAccessPoint(id);
  }

  @Post('equipment-assignments')
  @Roles(UserRole.ADMIN)
  assignEquipment(
    @CurrentUser() actor: AuthenticatedUser,
    @Body(new ZodValidationPipe(assignEquipmentSchema))
    input: AssignEquipmentInput,
  ) {
    return this.service.assignEquipment(input, actor.id);
  }

  @Get('maintenance')
  listMaintenance(
    @Query(new ZodValidationPipe(maintenanceFilterSchema))
    query: MaintenanceFilterInput,
  ) {
    return this.service.listMaintenance(query);
  }

  @Post('maintenance')
  scheduleMaintenance(
    @CurrentUser() actor: AuthenticatedUser,
    @Body(new ZodValidationPipe(scheduleMaintenanceSchema))
    input: ScheduleMaintenanceInput,
  ) {
    return this.service.scheduleMaintenance(input, actor.id);
  }

  @Patch('maintenance/:id/start')
  startMaintenance(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', UuidParamPipe) id: string,
  ) {
    return this.service.startMaintenance(id, actor.id);
  }

  @Patch('maintenance/:id/complete')
  completeMaintenance(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', UuidParamPipe) id: string,
    @Body(new ZodValidationPipe(completeMaintenanceSchema))
    input: CompleteMaintenanceInput,
  ) {
    return this.service.completeMaintenance(id, input, actor.id);
  }
}
