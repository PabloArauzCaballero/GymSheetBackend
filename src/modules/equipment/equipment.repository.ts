import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Op, Transaction } from 'sequelize';
import { EquipmentStatus } from '../../common/enums/domain.enums';
import { tenantScopeWhere } from '../../common/tenancy/tenant-scope';
import { EquipmentModel } from './equipment.model';
import { CreateEquipmentInput, UpdateEquipmentInput } from './equipment.schemas';

@Injectable()
export class EquipmentRepository {
  constructor(
    @InjectModel(EquipmentModel)
    private readonly equipmentModel: typeof EquipmentModel,
  ) {}

  findAvailable(tenantScope: string | null): Promise<EquipmentModel[]> {
    return this.equipmentModel.findAll({
      where: { status: EquipmentStatus.AVAILABLE, ...tenantScopeWhere(tenantScope) },
      order: [['name', 'ASC']],
    });
  }

  /**
   * Todo el equipamiento, sea cual sea su estado.
   *
   * `findAvailable` filtra por disponible, que es lo correcto para elegir en un
   * entrenamiento pero no para comprobar duplicados: una prensa en
   * mantenimiento sigue siendo una prensa que ya existe.
   */
  findAll(tenantScope: string | null): Promise<EquipmentModel[]> {
    return this.equipmentModel.findAll({
      where: tenantScopeWhere(tenantScope),
      order: [['name', 'ASC']],
    });
  }

  findById(equipmentId: string, transaction?: Transaction): Promise<EquipmentModel | null> {
    return this.equipmentModel.findByPk(equipmentId, { transaction });
  }

  /**
   * Filtra una lista de identificadores dejando los enlazables. El alcance
   * importa aqui tanto como en un listado: es la via por la que un ejercicio de
   * un gimnasio podria acabar apuntando al equipo de otro.
   */
  async findLinkableIds(
    equipmentIds: string[],
    tenantScope: string | null,
  ): Promise<string[]> {
    if (equipmentIds.length === 0) return [];
    const equipmentItems = await this.equipmentModel.findAll({
      attributes: ['id'],
      where: {
        id: { [Op.in]: [...new Set(equipmentIds)] },
        status: { [Op.ne]: EquipmentStatus.INACTIVE },
        ...tenantScopeWhere(tenantScope),
      },
    });
    return equipmentItems.map((equipment) => equipment.id);
  }

  create(input: CreateEquipmentInput, tenantId: string): Promise<EquipmentModel> {
    return this.equipmentModel.create({ ...input, tenantId });
  }

  async update(
    equipmentId: string,
    input: UpdateEquipmentInput | Record<string, unknown>,
    transaction?: Transaction,
  ): Promise<EquipmentModel | null> {
    const equipment = await this.findById(equipmentId, transaction);
    if (!equipment) return null;
    await equipment.update(input, { transaction });
    return equipment;
  }

  markInactive(equipmentId: string): Promise<EquipmentModel | null> {
    return this.update(equipmentId, { status: EquipmentStatus.INACTIVE });
  }
}
