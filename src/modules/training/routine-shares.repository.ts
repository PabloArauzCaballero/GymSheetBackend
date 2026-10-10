import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Op } from 'sequelize';
import { UserStatus } from '../../common/enums/domain.enums';
import { UserModel } from '../users/user.model';
import { RoutineShareModel, RoutineShareStatus } from './routine-share.model';

@Injectable()
export class RoutineSharesRepository {
  constructor(
    @InjectModel(RoutineShareModel) private readonly shareModel: typeof RoutineShareModel,
    @InjectModel(UserModel) private readonly userModel: typeof UserModel,
  ) {}

  findUsers(ids: readonly string[]): Promise<UserModel[]> {
    return this.userModel.findAll({ where: { id: { [Op.in]: [...ids] } } });
  }

  findLiveShare(routineId: string, inviteeId: string) {
    return this.shareModel.findOne({
      where: { routineId, inviteeId, status: { [Op.in]: ['PENDING', 'ACCEPTED'] } },
    });
  }

  createInvitation(routineId: string, ownerId: string, inviteeId: string) {
    return this.shareModel.create({
      routineId,
      ownerId,
      inviteeId,
      status: 'PENDING',
      origin: 'INVITACION',
    });
  }

  listForRoutine(routineId: string) {
    return this.shareModel.findAll({
      where: { routineId },
      order: [['createdAt', 'DESC']],
    });
  }

  findById(id: string) {
    return this.shareModel.findByPk(id);
  }

  listForInvitee(inviteeId: string, status?: RoutineShareStatus) {
    return this.shareModel.findAll({
      where: { inviteeId, ...(status ? { status } : {}) },
      order: [['createdAt', 'DESC']],
    });
  }

  isActive(user: UserModel): boolean {
    return user.status === UserStatus.ACTIVE;
  }
}
