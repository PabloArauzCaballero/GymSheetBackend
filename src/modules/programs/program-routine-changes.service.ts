import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Sequelize } from 'sequelize-typescript';
import { UserRole } from '../../common/enums/domain.enums';
import { ExercisesService } from '../exercises/exercises.service';
import { RoutineAccessService } from '../training/routine-access.service';
import { RoutineDaysRepository } from '../training/routine-days.repository';
import { RoutineStructureService } from '../training/routine-structure.service';
import { TrainingRepository } from '../training/training.repository';
import { TrainingService } from '../training/training.service';
import { WorkoutsRepository } from '../workouts/workouts.repository';
import { ApplyToRoutineInput } from './programs.schemas';

type Actor = { id: string; role: UserRole; tenantId: string };

/** RF-20: llevar a la rutina lo que realmente se hizo en la sesión. Las semanas futuras se regeneran solas. */
@Injectable()
export class ProgramRoutineChangesService {
  constructor(
    private readonly workouts: WorkoutsRepository,
    private readonly routines: TrainingRepository,
    private readonly days: RoutineDaysRepository,
    private readonly access: RoutineAccessService,
    private readonly structure: RoutineStructureService,
    private readonly exercises: ExercisesService,
    private readonly training: TrainingService,
    private readonly sequelize: Sequelize,
  ) {}

  async apply(actor: Actor, sessionId: string, input: ApplyToRoutineInput) {
    const session = await this.workouts.findSessionByIdForUser(sessionId, actor.id);
    if (!session) throw new NotFoundException('Sesión no encontrada.');
    if (!session.routineId) throw new BadRequestException('Esta sesión no nació de una rutina.');
    const routine = await this.routines.findRoutineById(session.routineId);
    if (!routine) throw new NotFoundException('Rutina no encontrada.');
    // Solo la copia propia: nunca se edita la rutina de otra persona desde su sesión.
    await this.access.assertCanEdit(actor, routine);

    const owned = new Map((routine.exercises ?? []).map((e) => [e.id, e]));
    for (const id of [...input.cambios.map((c) => c.routineExerciseId), ...input.quitar]) {
      if (!owned.has(id)) throw new BadRequestException('Un ejercicio no pertenece a la rutina.');
    }
    for (const added of input.agregar) {
      await this.exercises.getVisibleExerciseOrFail(added.ejercicioId, actor.id);
    }

    await this.sequelize.transaction(async (transaction) => {
      for (const change of input.cambios) {
        const target = owned.get(change.routineExerciseId);
        if (!target) continue;
        await this.routines.updateRoutineExercise(
          target,
          {
            ...(change.seriesObjetivo !== undefined ? { targetSets: change.seriesObjetivo } : {}),
            ...(change.repsMin !== undefined ? { repsMin: change.repsMin } : {}),
            ...(change.repsMax !== undefined ? { repsMax: change.repsMax } : {}),
            ...(change.pesoObjetivoKg !== undefined ? { targetWeightKg: change.pesoObjetivoKg } : {}),
          },
          transaction,
        );
      }
      for (const id of input.quitar) await this.routines.deleteRoutineExercise(id, transaction);

      const dayId = session.routineDayId ?? (await this.days.firstDayId(routine.id, transaction));
      let order = Math.max(0, ...(routine.exercises ?? []).map((e) => e.order));
      for (const added of input.agregar) {
        order += 1;
        await this.routines.addExercise(
          routine.id,
          added.ejercicioId,
          {
            exerciseId: added.ejercicioId,
            exerciseName: null,
            order,
            targetSets: added.seriesObjetivo,
            repsMin: added.repsMin ?? null,
            repsMax: added.repsMax ?? null,
            targetWeightKg: added.pesoObjetivoKg ?? null,
            targetRir: null,
            restSeconds: null,
            note: null,
          },
          dayId,
          transaction,
        );
      }
      await this.structure.afterStructureChange(routine, transaction);
    });
    await this.structure.announceNewVersion(routine);
    return this.training.getRoutineForUser(actor, routine.id);
  }
}
