import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Op } from 'sequelize';
import { EquipmentModel } from '../equipment/equipment.model';
import { FacilityStatus, RoomStatus } from '../../common/enums/domain.enums';
import { BranchModel } from './branch.model';
import { EquipmentAssignmentModel } from './equipment-assignment.model';
import { PublicBranchListQuery, publicRoomTypes } from './public-facilities.schemas';
import { RoomModel } from './room.model';

@Injectable()
export class PublicFacilitiesRepository {
  constructor(@InjectModel(BranchModel) private readonly branches: typeof BranchModel) {}

  /**
   * Directorio público: solo sedes activas. El filtro por `servicio` reduce
   * también las salas incluidas a esa sola categoría — quien filtra por
   * "Cardio" ve que el gimnasio lo tiene, no la lista completa de servicios
   * (para eso está la ficha, `findActiveBranchDetail`).
   */
  listActiveBranches(query: Omit<PublicBranchListQuery, 'limit'> & { limit: number }) {
    return this.branches.findAll({
      where: {
        status: FacilityStatus.ACTIVE,
        ...(query.search
          ? {
              [Op.or]: [
                { name: { [Op.iLike]: `%${query.search}%` } },
                { description: { [Op.iLike]: `%${query.search}%` } },
              ],
            }
          : {}),
      },
      include: [
        {
          model: RoomModel,
          required: Boolean(query.servicio),
          attributes: ['id', 'roomType'],
          where: {
            status: RoomStatus.ACTIVE,
            roomType: query.servicio ? query.servicio : { [Op.in]: publicRoomTypes },
          },
        },
      ],
      order: [['name', 'ASC']],
      limit: query.limit,
    });
  }

  findActiveBranchDetail(id: string) {
    return this.branches.findOne({
      where: { id, status: FacilityStatus.ACTIVE },
      include: [
        {
          model: RoomModel,
          required: false,
          where: { status: RoomStatus.ACTIVE, roomType: { [Op.in]: publicRoomTypes } },
          include: [
            {
              model: EquipmentAssignmentModel,
              required: false,
              where: { endedAt: null },
              include: [{ model: EquipmentModel, required: false }],
            },
          ],
        },
      ],
    });
  }

  /** Otras sedes activas de la misma cadena, para el mapa y el listado de "otras sucursales". */
  listActiveBranchesByBrand(brandName: string) {
    return this.branches.findAll({
      where: { status: FacilityStatus.ACTIVE, brandName },
      include: [
        {
          model: RoomModel,
          required: false,
          attributes: ['id', 'roomType'],
          where: { status: RoomStatus.ACTIVE, roomType: { [Op.in]: publicRoomTypes } },
        },
      ],
      order: [['name', 'ASC']],
    });
  }
}
