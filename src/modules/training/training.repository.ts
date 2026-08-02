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

const exercisesInclude = {
  model: RoutineExerciseModel,
  as: 'exercises',
  include: [{ model: ExerciseModel, as: 'exercise' }],
};

const clientInclude = { model: UserModel, as: 'client' };
const routineInclude = { model: RoutineModel, as: 'routine', include: [exercisesInclude] };

export function routineWhereForScope(
  scope: 'mine' | 'templates',
  userId: string,
): WhereOptions {
  if (scope === 'templates') {
    return { visibility: RoutineVisibility.TEMPLATE, status: RoutineStatus.ACTIVE };
  }
  return { createdByUserId: userId };
}

@Injectable()
export class TrainingRepository {
  constructor(
    @InjectModel(RoutineModel) private readonly routineModel: typeof RoutineModel,
    @InjectModel(RoutineExerciseModel)
    private readonly routineExerciseModel: typeof RoutineExerciseModel,
    @InjectModel(RoutineAssignmentModel)
    private readonly assignmentModel: typeof RoutineAssignmentModel,
    @InjectModel(ExerciseModel) private readonly exerciseModel: typeof ExerciseModel,
    @InjectModel(UserModel) private readonly userModel: typeof UserModel,
  ) {}

  createRoutine(
    ownerId: string,
    input: CreateRoutineInput,
    transaction?: Transaction,
  ): Promise<RoutineModel> {
    return this.routineModel.create(
      {
        name: input.name,
        description: input.description,
        createdByUserId: ownerId,
        visibility: input.visibility,
        goal: input.goal,
      },
      { transaction },
    );
  }

  findRoutineById(routineId: string): Promise<RoutineModel | null> {
    return this.routineModel.findByPk(routineId, {
      include: [exercisesInclude],
      order: [[{ model: RoutineExerciseModel, as: 'exercises' }, 'order', 'ASC']],
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
      include: [exercisesInclude],
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
    transaction?: Transaction,
  ): Promise<RoutineExerciseModel> {
    return this.routineExerciseModel.create(
      {
        routineId,
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
    await routineExercise.update(changes);
    return routineExercise;
  }

  deleteRoutineExercise(id: string): Promise<number> {
    return this.routineExerciseModel.destroy({ where: { id } });
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

  createAssignment(
    routineId: string,
    assignedById: string,
    input: AssignRoutineInput,
  ): Promise<RoutineAssignmentModel> {
    return this.assignmentModel.create({
      routineId,
      clientUserId: input.clientUserId,
      assignedByUserId: assignedById,
      scheduledFor: input.scheduledFor,
      weekdays: input.weekdays,
      note: input.note,
    });
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
