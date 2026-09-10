import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Sequelize } from 'sequelize-typescript';
import {
  EquipmentStatus,
  FacilityStatus,
  MaintenanceStatus,
  RoomStatus,
} from '../../common/enums/domain.enums';
import { AuthenticatedUser } from '../../common/types/auth-context.types';
import { EquipmentModel } from '../equipment/equipment.model';
import { EquipmentRepository } from '../equipment/equipment.repository';
import { GymDomainEvent } from '../integration/domain-event.catalog';
import { DomainEventPublisher } from '../integration/domain-event.publisher';
import {
  mapAccessPoint,
  mapBranch,
  mapEquipmentAssignment,
  mapMaintenance,
  mapRoom,
} from './facilities.mapper';
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
  UpdateAccessPointInput,
  UpdateBranchInput,
  UpdateRoomInput,
} from './facilities.schemas';

/**
 * Un solo mensaje para «no existe», «está inactivo» y «es de otro gimnasio».
 * Distinguirlos convertiría el identificador en un oráculo del inventario ajeno.
 */
const EQUIPMENT_UNAVAILABLE = 'El equipo no existe o está inactivo.';

@Injectable()
export class FacilitiesService {
  constructor(
    private readonly repository: FacilitiesRepository,
    private readonly equipmentRepository: EquipmentRepository,
    private readonly events: DomainEventPublisher,
    private readonly sequelize: Sequelize,
  ) {}

  async listBranches(actor: AuthenticatedUser, pagination: PaginationInput) {
    const result = await this.repository.listBranches(
      pagination,
      actor.tenantScope,
    );
    return this.page(result.rows.map(mapBranch), result.count, pagination);
  }

  /** El alta usa `tenantId`: se crea en el gimnasio del actor, no en su alcance. */
  async createBranch(actor: AuthenticatedUser, input: CreateBranchInput) {
    return mapBranch(
      await this.repository.createBranch(input, actor.tenantId),
    );
  }

  async updateBranch(
    actor: AuthenticatedUser,
    branchId: string,
    input: UpdateBranchInput,
  ) {
    const branch = await this.repository.findBranch(branchId, actor.tenantScope);
    if (!branch) throw new NotFoundException('Sede no encontrada.');
    return mapBranch(await this.repository.updateBranch(branch, input));
  }

  async deactivateBranch(actor: AuthenticatedUser, branchId: string) {
    const branch = await this.repository.findBranch(branchId, actor.tenantScope);
    if (!branch) throw new NotFoundException('Sede no encontrada.');
    return mapBranch(await this.repository.deactivateBranch(branch));
  }

  async listRooms(
    actor: AuthenticatedUser,
    branchId: string | undefined,
    pagination: PaginationInput,
  ) {
    const result = await this.repository.listRooms(
      branchId,
      pagination,
      actor.tenantScope,
    );
    return this.page(result.rows.map(mapRoom), result.count, pagination);
  }

  async createRoom(actor: AuthenticatedUser, input: CreateRoomInput) {
    const branch = await this.repository.findBranch(
      input.branchId,
      actor.tenantScope,
    );
    if (!branch || branch.status !== FacilityStatus.ACTIVE) {
      throw new UnprocessableEntityException(
        'La sede no existe o está inactiva.',
      );
    }
    return mapRoom(await this.repository.createRoom(input));
  }

  async updateRoom(
    actor: AuthenticatedUser,
    roomId: string,
    input: UpdateRoomInput,
  ) {
    const room = await this.repository.findRoom(roomId, actor.tenantScope);
    if (!room) throw new NotFoundException('Sala no encontrada.');
    return mapRoom(await this.repository.updateRoom(room, input));
  }

  async deactivateRoom(actor: AuthenticatedUser, roomId: string) {
    const room = await this.repository.findRoom(roomId, actor.tenantScope);
    if (!room) throw new NotFoundException('Sala no encontrada.');
    return mapRoom(await this.repository.deactivateRoom(room));
  }

  async createAccessPoint(
    actor: AuthenticatedUser,
    input: CreateAccessPointInput,
  ) {
    const branch = await this.repository.findBranch(
      input.branchId,
      actor.tenantScope,
    );
    if (!branch || branch.status !== FacilityStatus.ACTIVE) {
      throw new UnprocessableEntityException(
        'La sede no existe o está inactiva.',
      );
    }
    if (input.roomId) {
      const room = await this.repository.findRoom(
        input.roomId,
        actor.tenantScope,
      );
      if (
        !room ||
        room.branchId !== input.branchId ||
        room.status === RoomStatus.INACTIVE
      ) {
        throw new UnprocessableEntityException(
          'La sala no pertenece a la sede o está inactiva.',
        );
      }
    }
    return mapAccessPoint(await this.repository.createAccessPoint(input));
  }

  async listAccessPoints(actor: AuthenticatedUser, branchId?: string) {
    return (
      await this.repository.listAccessPoints(branchId, actor.tenantScope)
    ).map(mapAccessPoint);
  }

  async updateAccessPoint(
    actor: AuthenticatedUser,
    id: string,
    input: UpdateAccessPointInput,
  ) {
    const accessPoint = await this.repository.findAccessPoint(
      id,
      actor.tenantScope,
    );
    if (!accessPoint)
      throw new NotFoundException('Punto de acceso no encontrado.');
    return mapAccessPoint(
      await this.repository.updateAccessPoint(accessPoint, input),
    );
  }

  async deactivateAccessPoint(actor: AuthenticatedUser, id: string) {
    const accessPoint = await this.repository.findAccessPoint(
      id,
      actor.tenantScope,
    );
    if (!accessPoint)
      throw new NotFoundException('Punto de acceso no encontrado.');
    return mapAccessPoint(
      await this.repository.deactivateAccessPoint(accessPoint),
    );
  }

  async assignEquipment(
    actor: AuthenticatedUser,
    input: AssignEquipmentInput,
  ) {
    const actorUserId = actor.id;
    const assignment = await this.sequelize.transaction(async (transaction) => {
      const equipment = await this.equipmentRepository.findById(
        input.equipmentId,
        transaction,
      );
      const room = await this.repository.findRoom(
        input.roomId,
        actor.tenantScope,
        transaction,
      );
      this.assertEquipmentInScope(actor, equipment);
      if (equipment.status === EquipmentStatus.INACTIVE) {
        throw new UnprocessableEntityException(EQUIPMENT_UNAVAILABLE);
      }
      if (!room || room.status === RoomStatus.INACTIVE) {
        throw new UnprocessableEntityException(
          'La sala no existe o está inactiva.',
        );
      }

      const current = await this.repository.findActiveAssignment(
        input.equipmentId,
        transaction,
      );
      if (current?.roomId === input.roomId) {
        throw new ConflictException('El equipo ya está asignado a esta sala.');
      }
      if (current) {
        await this.repository.endAssignment(current, transaction);
      }

      const created = await this.repository.createAssignment(
        input,
        actorUserId,
        transaction,
      );
      await this.events.record(
        {
          eventName: GymDomainEvent.EQUIPMENT_ASSIGNED,
          aggregateType: 'equipment',
          aggregateId: input.equipmentId,
          deduplicationKey: `equipment.assigned:${created.id}`,
          actorUserId,
          payload: {
            equipmentId: input.equipmentId,
            assignmentId: created.id,
            previousRoomId: current?.roomId ?? null,
            roomId: input.roomId,
          },
        },
        transaction,
      );
      return created;
    });

    return mapEquipmentAssignment(assignment);
  }

  async scheduleMaintenance(
    actor: AuthenticatedUser,
    input: ScheduleMaintenanceInput,
  ) {
    const actorUserId = actor.id;
    const event = await this.sequelize.transaction(async (transaction) => {
      const equipment = await this.equipmentRepository.findById(
        input.equipmentId,
        transaction,
      );
      this.assertEquipmentInScope(actor, equipment);
      if (equipment.status === EquipmentStatus.INACTIVE) {
        throw new UnprocessableEntityException(EQUIPMENT_UNAVAILABLE);
      }

      const created = await this.repository.createMaintenance(
        input,
        actorUserId,
        transaction,
      );
      await this.events.record(
        {
          eventName: GymDomainEvent.MAINTENANCE_SCHEDULED,
          aggregateType: 'maintenance_event',
          aggregateId: created.id,
          deduplicationKey: `maintenance.scheduled:${created.id}`,
          actorUserId,
          payload: {
            equipmentId: input.equipmentId,
            maintenanceEventId: created.id,
            scheduledFor: input.scheduledFor,
          },
        },
        transaction,
      );
      return created;
    });

    return mapMaintenance(event);
  }

  async startMaintenance(actor: AuthenticatedUser, eventId: string) {
    const actorUserId = actor.id;
    const event = await this.sequelize.transaction(async (transaction) => {
      const record = await this.repository.findMaintenance(eventId, transaction);
      if (!record) throw new NotFoundException('Mantenimiento no encontrado.');
      // El equipo se carga antes de mutarlo: es lo único que dice de qué
      // gimnasio es este mantenimiento.
      this.assertEquipmentInScope(
        actor,
        await this.equipmentRepository.findById(record.equipmentId, transaction),
      );
      if (record.status !== MaintenanceStatus.SCHEDULED) {
        throw new ConflictException(
          'Solo un mantenimiento programado puede iniciarse.',
        );
      }

      await this.equipmentRepository.update(
        record.equipmentId,
        { status: EquipmentStatus.MAINTENANCE },
        transaction,
      );
      const updated = await this.repository.updateMaintenance(
        record,
        { status: MaintenanceStatus.IN_PROGRESS, startedAt: new Date() },
        transaction,
      );
      await this.events.record(
        {
          eventName: GymDomainEvent.MAINTENANCE_STARTED,
          aggregateType: 'maintenance_event',
          aggregateId: record.id,
          deduplicationKey: `maintenance.started:${record.id}`,
          actorUserId,
          payload: {
            equipmentId: record.equipmentId,
            maintenanceEventId: record.id,
            status: MaintenanceStatus.IN_PROGRESS,
          },
        },
        transaction,
      );
      return updated;
    });

    return mapMaintenance(event);
  }

  async completeMaintenance(
    actor: AuthenticatedUser,
    eventId: string,
    input: CompleteMaintenanceInput,
  ) {
    const actorUserId = actor.id;
    const event = await this.sequelize.transaction(async (transaction) => {
      const record = await this.repository.findMaintenance(eventId, transaction);
      if (!record) throw new NotFoundException('Mantenimiento no encontrado.');
      const equipment = await this.equipmentRepository.findById(
        record.equipmentId,
        transaction,
      );
      this.assertEquipmentInScope(actor, equipment);
      if (record.status !== MaintenanceStatus.IN_PROGRESS) {
        throw new ConflictException(
          'El mantenimiento debe estar en progreso para completarse.',
        );
      }

      const nextServiceOn = equipment.serviceIntervalDays
        ? this.addDays(new Date(), equipment.serviceIntervalDays)
        : null;
      await this.equipmentRepository.update(
        equipment.id,
        {
          status: EquipmentStatus.AVAILABLE,
          outOfServiceReason: null,
          nextServiceOn,
        },
        transaction,
      );
      const updated = await this.repository.updateMaintenance(
        record,
        {
          ...input,
          costAmount: input.costAmount?.toString() ?? null,
          status: MaintenanceStatus.COMPLETED,
          completedAt: new Date(),
        },
        transaction,
      );
      await this.events.record(
        {
          eventName: GymDomainEvent.MAINTENANCE_COMPLETED,
          aggregateType: 'maintenance_event',
          aggregateId: record.id,
          deduplicationKey: `maintenance.completed:${record.id}`,
          actorUserId,
          payload: {
            equipmentId: record.equipmentId,
            maintenanceEventId: record.id,
            status: MaintenanceStatus.COMPLETED,
            nextServiceOn,
          },
        },
        transaction,
      );
      return updated;
    });

    return mapMaintenance(event);
  }

  async listMaintenance(
    actor: AuthenticatedUser,
    filters: MaintenanceFilterInput,
  ) {
    const result = await this.repository.listMaintenance(
      filters,
      actor.tenantScope,
    );
    return this.page(result.rows.map(mapMaintenance), result.count, filters);
  }

  /**
   * Un equipo de otro gimnasio se responde igual que uno inexistente: si el
   * mensaje cambiara, el identificador de la petición serviría para averiguar
   * qué inventario tiene el vecino.
   */
  private assertEquipmentInScope(
    actor: AuthenticatedUser,
    equipment: EquipmentModel | null,
  ): asserts equipment is EquipmentModel {
    const inScope =
      equipment !== null &&
      (actor.tenantScope === null || equipment.tenantId === actor.tenantScope);
    if (!inScope) throw new UnprocessableEntityException(EQUIPMENT_UNAVAILABLE);
  }

  private page<T>(items: T[], total: number, pagination: PaginationInput) {
    return {
      items,
      page: pagination.page,
      pageSize: pagination.pageSize,
      total,
      totalPages: Math.ceil(total / pagination.pageSize),
    };
  }

  private addDays(date: Date, days: number): string {
    const result = new Date(
      Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
    );
    result.setUTCDate(result.getUTCDate() + days);
    return result.toISOString().slice(0, 10);
  }
}
