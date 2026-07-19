import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Op, Transaction } from 'sequelize';
import { MaintenanceStatus } from '../../common/enums/domain.enums';
import { AccessPointModel } from './access-point.model';
import { BranchModel } from './branch.model';
import { EquipmentAssignmentModel } from './equipment-assignment.model';
import { MaintenanceEventModel } from './maintenance-event.model';
import { RoomModel } from './room.model';
import {
  AssignEquipmentInput,
  CreateAccessPointInput,
  CreateBranchInput,
  CreateRoomInput,
  MaintenanceFilterInput,
  PaginationInput,
  ScheduleMaintenanceInput,
  UpdateBranchInput,
  UpdateRoomInput,
} from './facilities.schemas';

@Injectable()
export class FacilitiesRepository {
  constructor(
    @InjectModel(BranchModel) private readonly branches: typeof BranchModel,
    @InjectModel(RoomModel) private readonly rooms: typeof RoomModel,
    @InjectModel(AccessPointModel) private readonly accessPoints: typeof AccessPointModel,
    @InjectModel(EquipmentAssignmentModel) private readonly assignments: typeof EquipmentAssignmentModel,
    @InjectModel(MaintenanceEventModel) private readonly maintenance: typeof MaintenanceEventModel,
  ) {}

  listBranches(pagination: PaginationInput) {
    return this.branches.findAndCountAll({ limit: pagination.pageSize, offset: (pagination.page - 1) * pagination.pageSize, order: [['name', 'ASC']] });
  }

  findBranch(branchId: string, transaction?: Transaction) {
    return this.branches.findByPk(branchId, { transaction });
  }

  createBranch(input: CreateBranchInput) { return this.branches.create(input); }
  async updateBranch(branch: BranchModel, input: UpdateBranchInput) { await branch.update(input); return branch; }

  listRooms(branchId: string | undefined, pagination: PaginationInput) {
    return this.rooms.findAndCountAll({ where: branchId ? { branchId } : undefined, limit: pagination.pageSize, offset: (pagination.page - 1) * pagination.pageSize, order: [['name', 'ASC']] });
  }

  findRoom(roomId: string, transaction?: Transaction) { return this.rooms.findByPk(roomId, { transaction }); }
  createRoom(input: CreateRoomInput) { return this.rooms.create(input); }
  async updateRoom(room: RoomModel, input: UpdateRoomInput) { await room.update(input); return room; }
  createAccessPoint(input: CreateAccessPointInput) { return this.accessPoints.create(input); }

  listAccessPoints(branchId?: string) {
    return this.accessPoints.findAll({ where: branchId ? { branchId } : undefined, order: [['name', 'ASC']] });
  }

  findActiveAssignment(equipmentId: string, transaction?: Transaction) {
    return this.assignments.findOne({ where: { equipmentId, endedAt: null }, transaction, lock: transaction ? transaction.LOCK.UPDATE : undefined });
  }

  createAssignment(input: AssignEquipmentInput, assignedByUserId: string, transaction: Transaction) {
    return this.assignments.create({ ...input, assignedByUserId }, { transaction });
  }

  async endAssignment(assignment: EquipmentAssignmentModel, transaction: Transaction) {
    await assignment.update({ endedAt: new Date() }, { transaction });
  }

  createMaintenance(input: ScheduleMaintenanceInput, createdByUserId: string) {
    return this.maintenance.create({ ...input, createdByUserId });
  }

  findMaintenance(eventId: string, transaction?: Transaction) {
    return this.maintenance.findByPk(eventId, { transaction, lock: transaction ? transaction.LOCK.UPDATE : undefined });
  }

  listMaintenance(filters: MaintenanceFilterInput) {
    const where = {
      ...(filters.equipmentId ? { equipmentId: filters.equipmentId } : {}),
      ...(filters.status ? { status: filters.status } : {}),
    };
    return this.maintenance.findAndCountAll({ where, limit: filters.pageSize, offset: (filters.page - 1) * filters.pageSize, order: [['scheduledFor', 'DESC']] });
  }

  async updateMaintenance(event: MaintenanceEventModel, changes: Record<string, unknown>, transaction: Transaction) {
    await event.update(changes, { transaction });
    return event;
  }

  countOpenMaintenance(equipmentId: string, transaction?: Transaction) {
    return this.maintenance.count({ where: { equipmentId, status: { [Op.in]: [MaintenanceStatus.SCHEDULED, MaintenanceStatus.IN_PROGRESS] } }, transaction });
  }
}
