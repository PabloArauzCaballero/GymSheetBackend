import { EquipmentStatus, EquipmentType } from '../../common/enums/domain.enums';
import { EquipmentModel } from './equipment.model';

export type EquipmentResponse = {
  id: string;
  nombre: string;
  tipo: EquipmentType;
  descripcion: string | null;
  estado: EquipmentStatus;
  etiquetaActivo: string | null;
  numeroSerie: string | null;
  fabricante: string | null;
  modelo: string | null;
  fechaCompra: string | null;
  garantiaHasta: string | null;
  intervaloServicioDias: number | null;
  proximoServicio: string | null;
  razonFueraServicio: string | null;
  metadata: Record<string, unknown>;
};

export function mapEquipmentToResponse(equipment: EquipmentModel): EquipmentResponse {
  return {
    id: equipment.id,
    nombre: equipment.name,
    tipo: equipment.type,
    descripcion: equipment.description,
    estado: equipment.status,
    etiquetaActivo: equipment.assetTag,
    numeroSerie: equipment.serialNumber,
    fabricante: equipment.manufacturer,
    modelo: equipment.modelName,
    fechaCompra: equipment.purchasedOn,
    garantiaHasta: equipment.warrantyExpiresOn,
    intervaloServicioDias: equipment.serviceIntervalDays,
    proximoServicio: equipment.nextServiceOn,
    razonFueraServicio: equipment.outOfServiceReason,
    metadata: equipment.metadata,
  };
}
