import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Op, Transaction } from 'sequelize';
import { FacilityStatus, RoomStatus } from '../../common/enums/domain.enums';
import { tenantScopeWhere } from '../../common/tenancy/tenant-scope';
import { EquipmentModel } from '../equipment/equipment.model';
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
  UpdateAccessPointInput,
  UpdateBranchInput,
  UpdateRoomInput,
} from './facilities.schemas';

@Injectable()
export class FacilitiesRepository {
  constructor(
    @InjectModel(BranchModel) private readonly branches: typeof BranchModel,
    @InjectModel(RoomModel) private readonly rooms: typeof RoomModel,
    @InjectModel(AccessPointModel)
    private readonly accessPoints: typeof AccessPointModel,
    @InjectModel(EquipmentAssignmentModel)
    private readonly assignments: typeof EquipmentAssignmentModel,
    @InjectModel(MaintenanceEventModel)
    private readonly maintenance: typeof MaintenanceEventModel,
  ) {}

  /**
   * Alcance heredado de la sede.
   *
   * `rooms` y `access_points` no guardan gimnasio: el suyo es el de su sede, así
   * que el filtro entra por el JOIN. `required: true` es lo que lo convierte en
   * filtro — sin él sería un LEFT JOIN que devuelve la fila igual con la sede a
   * null, que es exactamente la fuga que esto cierra. `attributes: []` porque la
   * sede se une para filtrar, no para leerla.
   */
  private branchScopeInclude(tenantScope: string | null) {
    return [
      {
        model: BranchModel,
        required: true,
        attributes: [],
        where: tenantScopeWhere(tenantScope),
      },
    ];
  }

  listBranches(pagination: PaginationInput, tenantScope: string | null) {
    return this.branches.findAndCountAll({
      where: tenantScopeWhere(tenantScope),
      limit: pagination.pageSize,
      offset: (pagination.page - 1) * pagination.pageSize,
      order: [['name', 'ASC']],
    });
  }

  findBranch(
    branchId: string,
    tenantScope: string | null,
    transaction?: Transaction,
  ) {
    return this.branches.findOne({
      where: { id: branchId, ...tenantScopeWhere(tenantScope) },
      transaction,
    });
  }

  /**
   * Sedes activas con coordenadas configuradas, para la verificación de racha
   * por geolocalización. Se acota por `tenantId` y no por `tenantScope` a
   * propósito: quien entrena verifica contra las sedes de SU gimnasio, no contra
   * las de toda la plataforma.
   */
  findActiveBranchesWithCoordinates(tenantId: string): Promise<BranchModel[]> {
    return this.branches.findAll({
      where: {
        status: FacilityStatus.ACTIVE,
        latitude: { [Op.not]: null },
        longitude: { [Op.not]: null },
        geofenceRadiusM: { [Op.not]: null },
        ...tenantScopeWhere(tenantId),
      },
    });
  }

  createBranch(input: CreateBranchInput, tenantId: string) {
    return this.branches.create({ ...input, tenantId });
  }

  async updateBranch(branch: BranchModel, input: UpdateBranchInput) {
    await branch.update(input);
    return branch;
  }

  async deactivateBranch(branch: BranchModel) {
    await branch.update({ status: FacilityStatus.INACTIVE });
    return branch;
  }

  async deactivateRoom(room: RoomModel) {
    await room.update({ status: RoomStatus.INACTIVE });
    return room;
  }

  findAccessPoint(id: string, tenantScope: string | null) {
    return this.accessPoints.findOne({
      where: { id },
      include: this.branchScopeInclude(tenantScope),
    });
  }

  async updateAccessPoint(
    accessPoint: AccessPointModel,
    input: UpdateAccessPointInput,
  ) {
    await accessPoint.update(input);
    return accessPoint;
  }

  async deactivateAccessPoint(accessPoint: AccessPointModel) {
    await accessPoint.update({ status: FacilityStatus.INACTIVE });
    return accessPoint;
  }

  listRooms(
    branchId: string | undefined,
    pagination: PaginationInput,
    tenantScope: string | null,
  ) {
    return this.rooms.findAndCountAll({
      where: branchId ? { branchId } : undefined,
      include: this.branchScopeInclude(tenantScope),
      limit: pagination.pageSize,
      offset: (pagination.page - 1) * pagination.pageSize,
      order: [['name', 'ASC']],
      distinct: true,
    });
  }

  findRoom(
    roomId: string,
    tenantScope: string | null,
    transaction?: Transaction,
  ) {
    return this.rooms.findOne({
      where: { id: roomId },
      include: this.branchScopeInclude(tenantScope),
      transaction,
    });
  }

  createRoom(input: CreateRoomInput) {
    return this.rooms.create(input);
  }

  async updateRoom(room: RoomModel, input: UpdateRoomInput) {
    await room.update(input);
    return room;
  }

  createAccessPoint(input: CreateAccessPointInput) {
    return this.accessPoints.create(input);
  }

  listAccessPoints(branchId: string | undefined, tenantScope: string | null) {
    return this.accessPoints.findAll({
      where: branchId ? { branchId } : undefined,
      include: this.branchScopeInclude(tenantScope),
      order: [['name', 'ASC']],
    });
  }

  /**
   * Sin filtro de gimnasio a propósito: el `FOR UPDATE` de esta consulta no
   * admite el JOIN con `equipment` que haría de filtro. El alcance se comprueba
   * en el servicio sobre el equipo, antes de llegar aquí.
   */
  findActiveAssignment(equipmentId: string, transaction?: Transaction) {
    return this.assignments.findOne({
      where: { equipmentId, endedAt: null },
      transaction,
      lock: transaction ? transaction.LOCK.UPDATE : undefined,
    });
  }

  createAssignment(
    input: AssignEquipmentInput,
    assignedByUserId: string,
    transaction: Transaction,
  ) {
    return this.assignments.create(
      { ...input, assignedByUserId },
      { transaction },
    );
  }

  async endAssignment(
    assignment: EquipmentAssignmentModel,
    transaction: Transaction,
  ) {
    await assignment.update({ endedAt: new Date() }, { transaction });
  }

  createMaintenance(
    input: ScheduleMaintenanceInput,
    createdByUserId: string,
    transaction: Transaction,
  ) {
    return this.maintenance.create(
      { ...input, createdByUserId },
      { transaction },
    );
  }

  /** Igual que `findActiveAssignment`: el alcance lo comprueba el servicio. */
  findMaintenance(eventId: string, transaction?: Transaction) {
    return this.maintenance.findByPk(eventId, {
      transaction,
      lock: transaction ? transaction.LOCK.UPDATE : undefined,
    });
  }

  listMaintenance(
    filters: MaintenanceFilterInput,
    tenantScope: string | null,
  ) {
    const where = {
      ...(filters.equipoId ? { equipmentId: filters.equipoId } : {}),
      ...(filters.estado ? { status: filters.estado } : {}),
    };
    return this.maintenance.findAndCountAll({
      where,
      // El mantenimiento no guarda gimnasio: lo hereda del equipo intervenido.
      include: [
        {
          model: EquipmentModel,
          required: true,
          attributes: [],
          where: tenantScopeWhere(tenantScope),
        },
      ],
      limit: filters.pageSize,
      offset: (filters.page - 1) * filters.pageSize,
      order: [['scheduledFor', 'DESC']],
      distinct: true,
    });
  }

  async updateMaintenance(
    event: MaintenanceEventModel,
    changes: Record<string, unknown>,
    transaction: Transaction,
  ) {
    await event.update(changes, { transaction });
    return event;
  }
}
