import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { RoutineAssignmentStatus } from '../../common/enums/domain.enums';
import { DomainException } from '../../common/errors/domain.exception';
import { AccessUser, canEditRoutine, canViewRoutine, RoutineView } from './routine-access.policy';
import { RoutineAssignmentModel } from './routine-assignment.model';
import { RoutineShareModel } from './routine-share.model';
import { RoutineModel } from './routine.model';

/** Resuelve `canView`/`canEdit` con los datos que la política pura necesita (invitación, asignación). */
@Injectable()
export class RoutineAccessService {
  constructor(
    @InjectModel(RoutineShareModel) private readonly shareModel: typeof RoutineShareModel,
    @InjectModel(RoutineAssignmentModel)
    private readonly assignmentModel: typeof RoutineAssignmentModel,
  ) {}

  async resolveView(user: AccessUser, routine: RoutineModel): Promise<RoutineView> {
    if (routine.createdByUserId === user.id) return 'FULL';
    const share = await this.shareModel.findOne({
      where: { routineId: routine.id, inviteeId: user.id },
      order: [['createdAt', 'DESC']],
    });
    const assignment = await this.assignmentModel.count({
      where: {
        routineId: routine.id,
        clientUserId: user.id,
        status: RoutineAssignmentStatus.ACTIVE,
      },
    });
    return canViewRoutine(user, routine, share?.status ?? null, assignment > 0);
  }

  /** Contenido completo o 404 (no confirma que exista). Invitación pendiente → SHARE_PENDING. */
  async assertFullView(user: AccessUser, routine: RoutineModel): Promise<void> {
    const view = await this.resolveView(user, routine);
    if (view === 'FULL') return;
    if (view === 'INVITATION_ONLY') {
      throw new DomainException(403, 'SHARE_PENDING', 'Acepta la invitación para ver esta rutina.');
    }
    throw new NotFoundException('Rutina no encontrada.');
  }

  /** Quien la ve pero no la edita recibe 403; quien ni la ve, 404 (no se confirma que exista). */
  async assertCanEdit(user: AccessUser, routine: RoutineModel): Promise<void> {
    if (canEditRoutine(user, routine)) return;
    if ((await this.resolveView(user, routine)) === 'FULL') {
      throw new ForbiddenException('No puedes modificar esta rutina.');
    }
    throw new NotFoundException('Rutina no encontrada.');
  }
}
