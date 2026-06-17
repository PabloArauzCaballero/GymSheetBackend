import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { EquipmentStatus } from '../../common/enums/domain.enums';
import { EquipmentModel } from './equipment.model';
import { CreateEquipmentInput, UpdateEquipmentInput } from './equipment.schemas';

@Injectable()
export class EquipmentRepository {
  constructor(@InjectModel(EquipmentModel) private readonly equipmentModel: typeof EquipmentModel) {}

  findAvailable(): Promise<EquipmentModel[]> {
    return this.equipmentModel.findAll({
      where: { estado: EquipmentStatus.DISPONIBLE },
      order: [['tipo', 'ASC'], ['nombre', 'ASC']],
    });
  }

  findById(id: string): Promise<EquipmentModel | null> {
    return this.equipmentModel.findByPk(id);
  }

  create(input: CreateEquipmentInput): Promise<EquipmentModel> {
    return this.equipmentModel.create(input);
  }

  async update(id: string, input: UpdateEquipmentInput): Promise<EquipmentModel | null> {
    const equipment = await this.findById(id);
    if (!equipment) return null;
    await equipment.update(input);
    return equipment;
  }

  async markInactive(id: string): Promise<EquipmentModel | null> {
    return this.update(id, { estado: EquipmentStatus.INACTIVO });
  }
}
