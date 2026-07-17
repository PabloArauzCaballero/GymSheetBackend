import { EquipmentStatus, EquipmentType } from '../../common/enums/domain.enums';
import { EquipmentModel } from './equipment.model';

export type EquipmentResponse = {
  id: string;
  nombre: string;
  tipo: EquipmentType;
  descripcion: string | null;
  estado: EquipmentStatus;
};

/** Maps an equipment model to the established v1 API response. */
export function mapEquipmentToResponse(equipment: EquipmentModel): EquipmentResponse {
  return {
    id: equipment.id,
    nombre: equipment.name,
    tipo: equipment.type,
    descripcion: equipment.description,
    estado: equipment.status,
  };
}
