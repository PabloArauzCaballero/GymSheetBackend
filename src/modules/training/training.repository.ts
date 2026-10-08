import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Op, Transaction, WhereOptions } from 'sequelize';
import {
  ExerciseStatus,
  ExerciseType,
  RoutineAssignmentStatus,
  RoutineStatus,
  RoutineVisibility,
} from '../../common/enums/domain.enums';
import { ExerciseModel } from '../exercises/exercise.model';
import { UserModel } from '../users/user.model';
import { RoutineAssignmentModel } from './routine-assignment.model';
import { RoutineShareModel } from './routine-share.model';
import { RoutineDayModel } from './routine-day.model';
import { RoutineExerciseModel } from './routine-exercise.model';
import { RoutineModel } from './routine.model';
import {
  AssignRoutineInput,
  CreateRoutineInput,
  RoutineExerciseInput,
  UpdateRoutineExerciseInput,
  UpdateRoutineInput,
} from './training.schemas';

export type RoutinePage = { rows: RoutineModel[]; count: number };

const daysInclude = { model: RoutineDayModel, as: 'days' };

const exercisesInclude = {
  model: RoutineExerciseModel,
  as: 'exercises',
  include: [{ model: ExerciseModel, as: 'exercise' }],
};

const clientInclude = { model: UserModel, as: 'client' };
const routineInclude = {
  model: RoutineModel,
  as: 'routine',
  include: [exercisesInclude, daysInclude],
};

export function routineWhereForScope(
  scope: 'mine' | 'templates',
  userId: string,
): WhereOptions {
  if (scope === 'templates') {
    // Compatibilidad: lo que antes eran «plantillas» ahora son las públicas.
    return {
      visibility: { [Op.in]: [RoutineVisibility.PUBLIC, RoutineVisibility.TEMPLATE] },
      status: RoutineStatus.ACTIVE,
      moderationState: 'VISIBLE',
    };
  }
  return { createdByUserId: userId, status: RoutineStatus.ACTIVE };
}

@Injectable()
export class TrainingRepository {
  constructor(
    @InjectModel(RoutineModel) private readonly routineModel: typeof RoutineModel,
    @InjectModel(RoutineExerciseModel)
    private readonly routineExerciseModel: typeof RoutineExerciseModel,
    @InjectModel(RoutineAssignmentModel)
    private readonly assignmentModel: typeof RoutineAssignmentModel,
    @InjectModel(RoutineShareModel) private readonly shareModel: typeof RoutineShareModel,
    @InjectModel(ExerciseModel) private readonly exerciseModel: typeof ExerciseModel,
    @InjectModel(UserModel) private readonly userModel: typeof UserModel,
  ) {}

  createRoutine(
    ownerId: string,
    input: Omit<CreateRoutineInput, 'days'>,
    authorTenantId: string | null,
    transaction?: Transaction,
  ): Promise<RoutineModel> {
    return this.routineModel.create(
      {
        name: input.name,
        description: input.description,
        createdByUserId: ownerId,
        visibility: input.visibility,
        goal: input.goal,
        durationWeeks: input.durationWeeks,
        progressionConfig: input.progression ?? {},
        authorTenantId,
      },
      { transaction },
    );
  }

  findRoutineById(routineId: string): Promise<RoutineModel | null> {
    return this.routineModel.findByPk(routineId, {
      include: [exercisesInclude, daysInclude],
      order: [[{ model: RoutineExerciseModel, as: 'exercises' }, 'order', 'ASC']],
    });
  }

  /** La única rutina pública, activa y visible con esa huella (índice único parcial). */
  findPublicByFingerprint(fingerprint: string): Promise<RoutineModel | null> {
    return this.routineModel.findOne({
      where: {
        fingerprint,
        visibility: RoutineVisibility.PUBLIC,
        status: RoutineStatus.ACTIVE,
        moderationState: 'VISIBLE',
      },
    });
  }

  async findAuthorName(userId: string): Promise<string | null> {
    return (await this.userModel.findByPk(userId))?.fullName ?? null;
  }

  async findVersionOf(routineId: string): Promise<number | null> {
    const row = await this.routineModel.findByPk(routineId, { attributes: ['version', 'status'] });
    return row && row.status === RoutineStatus.ACTIVE ? row.version : null;
  }

  /** Copias vivas de una rutina (para avisar de una versión nueva). */
  listCopiesOf(routineId: string): Promise<RoutineModel[]> {
    return this.routineModel.findAll({
      where: { basedOnRoutineId: routineId, status: RoutineStatus.ACTIVE },
    });
  }

  listRoutines(
    where: WhereOptions,
    page: number,
    pageSize: number,
  ): Promise<RoutinePage> {
    return this.routineModel.findAndCountAll({
      where,
      distinct: true,
      limit: pageSize,
      offset: (page - 1) * pageSize,
      include: [exercisesInclude, daysInclude],
      order: [
        ['updatedAt', 'DESC'],
        [{ model: RoutineExerciseModel, as: 'exercises' }, 'order', 'ASC'],
      ],
    });
  }

  async updateRoutine(
    routine: RoutineModel,
    input: UpdateRoutineInput,
  ): Promise<RoutineModel> {
    await routine.update(input);
    return routine;
  }

  deleteRoutine(routineId: string): Promise<number> {
    return this.routineModel.destroy({ where: { id: routineId } });
  }

  addExercise(
    routineId: string,
    exerciseId: string,
    input: RoutineExerciseInput,
    dayId: string | null,
    transaction?: Transaction,
  ): Promise<RoutineExerciseModel> {
    return this.routineExerciseModel.create(
      {
        routineId,
        routineDayId: dayId,
        exerciseId,
        order: input.order,
        targetSets: input.targetSets,
        repsMin: input.repsMin,
        repsMax: input.repsMax,
        targetWeightKg: input.targetWeightKg == null ? null : input.targetWeightKg.toString(),
        targetRir: input.targetRir,
        restSeconds: input.restSeconds,
        note: input.note,
      },
      { transaction },
    );
  }

  findRoutineExerciseById(id: string): Promise<RoutineExerciseModel | null> {
    return this.routineExerciseModel.findByPk(id, {
      include: [{ model: RoutineModel, as: 'routine' }],
    });
  }

  async updateRoutineExercise(
    routineExercise: RoutineExerciseModel,
    input: UpdateRoutineExerciseInput,
    transaction?: Transaction,
  ): Promise<RoutineExerciseModel> {
    const changes = {
      ...input,
      ...(input.targetWeightKg !== undefined
        ? {
            targetWeightKg:
              input.targetWeightKg == null ? null : input.targetWeightKg.toString(),
          }
        : {}),
    };
    await routineExercise.update(changes, { transaction });
    return routineExercise;
  }

  deleteRoutineExercise(id: string, transaction?: Transaction): Promise<number> {
    return this.routineExerciseModel.destroy({ where: { id }, transaction });
  }

  /** Resolves a visible exercise by exact name (case-insensitive) for bulk import. */
  findVisibleExerciseByName(name: string, userId: string): Promise<ExerciseModel | null> {
    return this.exerciseModel.findOne({
      where: {
        name: { [Op.iLike]: name },
        status: ExerciseStatus.ACTIVE,
        [Op.or]: [{ type: ExerciseType.GLOBAL }, { createdByUserId: userId }],
      } as WhereOptions,
    });
  }

  /**
   * Programación propia del cliente: una sola asignación viva por rutina, así
   * que reprogramar actualiza la existente en vez de acumular duplicados que
   * competirían por el mismo día de la semana.
   */
  async upsertSelfAssignment(
    routineId: string,
    userId: string,
    values: {
      weekdays: number[];
      repeatsFrom: string | null;
      repeatsUntil: string | null;
    },
  ) {
    const existing = await this.assignmentModel.findOne({
      where: { routineId, clientUserId: userId },
    });
    if (existing) {
      return existing.update({
        weekdays: values.weekdays,
        repeatsFrom: values.repeatsFrom,
        repeatsUntil: values.repeatsUntil,
        status: RoutineAssignmentStatus.ACTIVE,
      });
    }
    return this.assignmentModel.create({
      routineId,
      clientUserId: userId,
      // Nadie se la asignó: el propio usuario es el origen.
      assignedByUserId: userId,
      status: RoutineAssignmentStatus.ACTIVE,
      weekdays: values.weekdays,
      repeatsFrom: values.repeatsFrom,
      repeatsUntil: values.repeatsUntil,
      scheduledFor: null,
      note: null,
    });
  }

  createAssignment(
    routineId: string,
    assignedById: string,
    input: AssignRoutineInput,
    transaction?: Transaction,
  ): Promise<RoutineAssignmentModel> {
    return this.assignmentModel.create(
      {
        routineId,
        clientUserId: input.clientUserId,
        assignedByUserId: assignedById,
        scheduledFor: input.scheduledFor,
        weekdays: input.weekdays,
        note: input.note,
      },
      { transaction },
    );
  }

  /** D15: una asignación del entrenador queda como compartida aceptada (idempotente). */
  async ensureCoachShare(
    routineId: string,
    ownerId: string,
    inviteeId: string,
    transaction?: Transaction,
  ): Promise<void> {
    const existing = await this.shareModel.findOne({
      where: { routineId, inviteeId, status: { [Op.in]: ['PENDING', 'ACCEPTED'] } },
      transaction,
    });
    if (existing) {
      if (existing.status === 'PENDING') {
        await existing.update({ status: 'ACCEPTED', respondedAt: new Date() }, { transaction });
      }
      return;
    }
    await this.shareModel.create(
      { routineId, ownerId, inviteeId, status: 'ACCEPTED', origin: 'ENTRENADOR', respondedAt: new Date() },
      { transaction },
    );
  }

  findAssignmentById(id: string): Promise<RoutineAssignmentModel | null> {
    return this.assignmentModel.findByPk(id, {
      include: [routineInclude, clientInclude],
    });
  }

  listAssignmentsForClient(clientUserId: string): Promise<RoutineAssignmentModel[]> {
    return this.assignmentModel.findAll({
      where: { clientUserId, status: RoutineAssignmentStatus.ACTIVE },
      include: [routineInclude, clientInclude],
      order: [['createdAt', 'DESC']],
    });
  }

  listAssignmentsByCoach(assignedByUserId: string): Promise<RoutineAssignmentModel[]> {
    return this.assignmentModel.findAll({
      where: { assignedByUserId },
      include: [routineInclude, clientInclude],
      order: [['createdAt', 'DESC']],
    });
  }

  findClientById(clientUserId: string): Promise<UserModel | null> {
    return this.userModel.findByPk(clientUserId);
  }
}
