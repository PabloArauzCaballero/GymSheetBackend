import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { EquipmentStatus } from '../../common/enums/domain.enums';
import { EquipmentModel } from './equipment.model';
import { CreateEquipmentInput, UpdateEquipmentInput } from './equipment.schemas';

@Injectable()
export class EquipmentRepository {
  constructor(
    @InjectModel(EquipmentModel)
    private readonly equipmentModel: typeof EquipmentModel,
  ) {}

  findAvailable(): Promise<EquipmentModel[]> {
    return this.equipmentModel.findAll({
      where: { status: EquipmentStatus.DISPONIBLE },
      order: [
        ['type', 'ASC'],
        ['name', 'ASC'],
      ],
    });
  }

  findById(equipmentId: string): Promise<EquipmentModel | null> {
    return this.equipmentModel.findByPk(equipmentId);
  }

  create(input: CreateEquipmentInput): Promise<EquipmentModel> {
    return this.equipmentModel.create(input);
  }

  async update(
    equipmentId: string,
    input: UpdateEquipmentInput,
  ): Promise<EquipmentModel | null> {
    const equipment = await this.findById(equipmentId);

    if (!equipment) {
      return null;
    }

    await equipment.update(input);
    return equipment;
  }

  markInactive(equipmentId: string): Promise<EquipmentModel | null> {
    return this.update(equipmentId, { status: EquipmentStatus.INACTIVO });
  }
}
