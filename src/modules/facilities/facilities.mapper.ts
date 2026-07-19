import { AccessDirection, FacilityStatus, MaintenanceStatus, MaintenanceType, RoomStatus, RoomType } from '../../common/enums/domain.enums';
import { AccessPointModel } from './access-point.model';
import { BranchModel } from './branch.model';
import { EquipmentAssignmentModel } from './equipment-assignment.model';
import { MaintenanceEventModel } from './maintenance-event.model';
import { RoomModel } from './room.model';

export function mapBranch(branch: BranchModel) {
  return { id: branch.id, codigo: branch.code, nombre: branch.name, descripcion: branch.description, zonaHoraria: branch.timeZone, estado: branch.status as FacilityStatus, metadata: branch.metadata };
}

export function mapRoom(room: RoomModel) {
  return { id: room.id, sedeId: room.branchId, codigo: room.code, nombre: room.name, tipoSala: room.roomType as RoomType, capacidad: room.capacity, estado: room.status as RoomStatus, metadata: room.metadata };
}

export function mapAccessPoint(point: AccessPointModel) {
  return { id: point.id, sedeId: point.branchId, salaId: point.roomId, codigo: point.code, nombre: point.name, direccionPermitida: point.allowedDirection as AccessDirection, estado: point.status, metadata: point.metadata };
}

export function mapEquipmentAssignment(assignment: EquipmentAssignmentModel) {
  return { id: assignment.id, equipoId: assignment.equipmentId, salaId: assignment.roomId, asignadoEn: assignment.assignedAt, finalizadoEn: assignment.endedAt, notas: assignment.notes, asignadoPorUsuarioId: assignment.assignedByUserId };
}

export function mapMaintenance(event: MaintenanceEventModel) {
  return {
    id: event.id,
    equipoId: event.equipmentId,
    tipo: event.maintenanceType as MaintenanceType,
    estado: event.status as MaintenanceStatus,
    programadoPara: event.scheduledFor,
    iniciadoEn: event.startedAt,
    completadoEn: event.completedAt,
    proveedor: event.vendorName,
    tecnico: event.technicianName,
    descripcion: event.description,
    hallazgos: event.findings,
    resolucion: event.resolution,
    costo: event.costAmount === null ? null : Number(event.costAmount),
    moneda: event.costCurrency,
  };
}
