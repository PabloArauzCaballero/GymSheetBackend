import { ConflictException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { Sequelize } from 'sequelize-typescript';
import { EquipmentStatus, FacilityStatus, MaintenanceStatus, RoomStatus } from '../../common/enums/domain.enums';
import { EquipmentRepository } from '../equipment/equipment.repository';
import { mapAccessPoint, mapBranch, mapEquipmentAssignment, mapMaintenance, mapRoom } from './facilities.mapper';
import { FacilitiesRepository } from './facilities.repository';
import {
  AssignEquipmentInput,
  CompleteMaintenanceInput,
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
export class FacilitiesService {
  constructor(
    private readonly repository: FacilitiesRepository,
    private readonly equipmentRepository: EquipmentRepository,
    private readonly sequelize: Sequelize,
  ) {}

  async listBranches(pagination: PaginationInput) {
    const result = await this.repository.listBranches(pagination);
    return this.page(result.rows.map(mapBranch), result.count, pagination);
  }

  async createBranch(input: CreateBranchInput) { return mapBranch(await this.repository.createBranch(input)); }

  async updateBranch(branchId: string, input: UpdateBranchInput) {
    const branch = await this.repository.findBranch(branchId);
    if (!branch) throw new NotFoundException('Sede no encontrada.');
    return mapBranch(await this.repository.updateBranch(branch, input));
  }

  async listRooms(branchId: string | undefined, pagination: PaginationInput) {
    const result = await this.repository.listRooms(branchId, pagination);
    return this.page(result.rows.map(mapRoom), result.count, pagination);
  }

  async createRoom(input: CreateRoomInput) {
    const branch = await this.repository.findBranch(input.branchId);
    if (!branch || branch.status !== FacilityStatus.ACTIVE) throw new UnprocessableEntityException('La sede no existe o está inactiva.');
    return mapRoom(await this.repository.createRoom(input));
  }

  async updateRoom(roomId: string, input: UpdateRoomInput) {
    const room = await this.repository.findRoom(roomId);
    if (!room) throw new NotFoundException('Sala no encontrada.');
    return mapRoom(await this.repository.updateRoom(room, input));
  }

  async createAccessPoint(input: CreateAccessPointInput) {
    const branch = await this.repository.findBranch(input.branchId);
    if (!branch || branch.status !== FacilityStatus.ACTIVE) throw new UnprocessableEntityException('La sede no existe o está inactiva.');
    if (input.roomId) {
      const room = await this.repository.findRoom(input.roomId);
      if (!room || room.branchId !== input.branchId || room.status === RoomStatus.INACTIVE) throw new UnprocessableEntityException('La sala no pertenece a la sede o está inactiva.');
    }
    return mapAccessPoint(await this.repository.createAccessPoint(input));
  }

  async listAccessPoints(branchId?: string) {
    return (await this.repository.listAccessPoints(branchId)).map(mapAccessPoint);
  }

  async assignEquipment(input: AssignEquipmentInput, actorUserId: string) {
    const assignment = await this.sequelize.transaction(async (transaction) => {
      const equipment = await this.equipmentRepository.findById(input.equipmentId, transaction);
      const room = await this.repository.findRoom(input.roomId, transaction);
      if (!equipment || equipment.status === EquipmentStatus.INACTIVE) throw new UnprocessableEntityException('El equipo no existe o está inactivo.');
      if (!room || room.status === RoomStatus.INACTIVE) throw new UnprocessableEntityException('La sala no existe o está inactiva.');
      const current = await this.repository.findActiveAssignment(input.equipmentId, transaction);
      if (current?.roomId === input.roomId) throw new ConflictException('El equipo ya está asignado a esta sala.');
      if (current) await this.repository.endAssignment(current, transaction);
      return this.repository.createAssignment(input, actorUserId, transaction);
    });
    return mapEquipmentAssignment(assignment);
  }

  async scheduleMaintenance(input: ScheduleMaintenanceInput, actorUserId: string) {
    const equipment = await this.equipmentRepository.findById(input.equipmentId);
    if (!equipment || equipment.status === EquipmentStatus.INACTIVE) throw new UnprocessableEntityException('El equipo no existe o está inactivo.');
    return mapMaintenance(await this.repository.createMaintenance(input, actorUserId));
  }

  async startMaintenance(eventId: string) {
    const event = await this.sequelize.transaction(async (transaction) => {
      const record = await this.repository.findMaintenance(eventId, transaction);
      if (!record) throw new NotFoundException('Mantenimiento no encontrado.');
      if (record.status !== MaintenanceStatus.SCHEDULED) throw new ConflictException('Solo un mantenimiento programado puede iniciarse.');
      await this.equipmentRepository.update(record.equipmentId, { status: EquipmentStatus.MAINTENANCE }, transaction);
      return this.repository.updateMaintenance(record, { status: MaintenanceStatus.IN_PROGRESS, startedAt: new Date() }, transaction);
    });
    return mapMaintenance(event);
  }

  async completeMaintenance(eventId: string, input: CompleteMaintenanceInput) {
    const event = await this.sequelize.transaction(async (transaction) => {
      const record = await this.repository.findMaintenance(eventId, transaction);
      if (!record) throw new NotFoundException('Mantenimiento no encontrado.');
      if (record.status !== MaintenanceStatus.IN_PROGRESS) throw new ConflictException('El mantenimiento debe estar en progreso para completarse.');
      const equipment = await this.equipmentRepository.findById(record.equipmentId, transaction);
      if (!equipment) throw new NotFoundException('Equipo no encontrado.');
      const nextServiceOn = equipment.serviceIntervalDays
        ? this.addDays(new Date(), equipment.serviceIntervalDays)
        : null;
      await this.equipmentRepository.update(equipment.id, { status: EquipmentStatus.AVAILABLE, outOfServiceReason: null, nextServiceOn }, transaction);
      return this.repository.updateMaintenance(record, { ...input, costAmount: input.costAmount?.toString() ?? null, status: MaintenanceStatus.COMPLETED, completedAt: new Date() }, transaction);
    });
    return mapMaintenance(event);
  }

  async listMaintenance(filters: MaintenanceFilterInput) {
    const result = await this.repository.listMaintenance(filters);
    return this.page(result.rows.map(mapMaintenance), result.count, filters);
  }

  private page<T>(items: T[], total: number, pagination: PaginationInput) {
    return { items, page: pagination.page, pageSize: pagination.pageSize, total, totalPages: Math.ceil(total / pagination.pageSize) };
  }

  private addDays(date: Date, days: number): string {
    const result = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
    result.setUTCDate(result.getUTCDate() + days);
    return result.toISOString().slice(0, 10);
  }
}
