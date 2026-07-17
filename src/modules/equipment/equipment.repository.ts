import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Op } from 'sequelize';
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
      where: { status: EquipmentStatus.AVAILABLE },
      order: [
        ['type', 'ASC'],
        ['name', 'ASC'],
      ],
    });
  }

  findById(equipmentId: string): Promise<EquipmentModel | null> {
    return this.equipmentModel.findByPk(equipmentId);
  }

  async findLinkableIds(equipmentIds: string[]): Promise<string[]> {
    if (equipmentIds.length === 0) {
      return [];
    }

    const equipmentItems = await this.equipmentModel.findAll({
      attributes: ['id'],
      where: {
        id: { [Op.in]: [...new Set(equipmentIds)] },
        status: { [Op.ne]: EquipmentStatus.INACTIVE },
      },
    });

    return equipmentItems.map((equipment) => equipment.id);
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
    return this.update(equipmentId, { status: EquipmentStatus.INACTIVE });
  }
}
