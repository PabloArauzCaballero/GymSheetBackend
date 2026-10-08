import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Transaction } from 'sequelize';
import { RoutineDayModel } from './routine-day.model';
import { RoutineExerciseModel } from './routine-exercise.model';
import { RoutineWeekOverrideModel } from './routine-week-override.model';
import { RoutineModel } from './routine.model';
import { routineFingerprint } from './routine-fingerprint';
import { RoutineDayInput, WeekOverrideInput } from './routine-v2.schemas';

/** Días, ejercicios por día, ajustes de semana y huella de una rutina. */
@Injectable()
export class RoutineDaysRepository {
  constructor(
    @InjectModel(RoutineDayModel) private readonly dayModel: typeof RoutineDayModel,
    @InjectModel(RoutineExerciseModel)
    private readonly exerciseModel: typeof RoutineExerciseModel,
    @InjectModel(RoutineWeekOverrideModel)
    private readonly overrideModel: typeof RoutineWeekOverrideModel,
    @InjectModel(RoutineModel) private readonly routineModel: typeof RoutineModel,
  ) {}

  findDays(routineId: string): Promise<RoutineDayModel[]> {
    return this.dayModel.findAll({ where: { routineId }, order: [['order', 'ASC']] });
  }

  /** Día al que va un ejercicio añadido por la vía antigua (sin día): el primero; se crea si no hay. */
  async firstDayId(routineId: string, transaction?: Transaction): Promise<string> {
    const first = await this.dayModel.findOne({
      where: { routineId },
      order: [['order', 'ASC']],
      transaction,
    });
    if (first) return first.id;
    const created = await this.dayModel.create(
      { routineId, weekday: null, name: null, order: 1 },
      { transaction },
    );
    return created.id;
  }

  /**
   * Reemplaza todos los días y ejercicios. `orden` es único por rutina, así
   * que corre sin huecos a través de los días (día 1: 1..n, día 2: n+1..).
   * Los ids de ejercicios ya deben estar validados por el servicio.
   */
  async replaceStructure(
    routineId: string,
    days: readonly RoutineDayInput[],
    transaction: Transaction,
  ): Promise<void> {
    await this.exerciseModel.destroy({ where: { routineId }, transaction });
    await this.dayModel.destroy({ where: { routineId }, transaction });
    let running = 0;
    for (const [dayIndex, day] of days.entries()) {
      const created = await this.dayModel.create(
        { routineId, weekday: day.weekday, name: day.name, order: dayIndex + 1 },
        { transaction },
      );
      for (const exercise of day.exercises) {
        running += 1;
        await this.exerciseModel.create(
          {
            routineId,
            routineDayId: created.id,
            exerciseId: exercise.exerciseId,
            order: running,
            targetSets: exercise.targetSets,
            repsMin: exercise.repsMin,
            repsMax: exercise.repsMax,
            targetWeightKg:
              exercise.targetWeightKg == null ? null : exercise.targetWeightKg.toString(),
            targetRir: exercise.targetRir,
            restSeconds: exercise.restSeconds,
            note: exercise.note,
          },
          { transaction },
        );
      }
    }
  }

  /** Calcula la huella con el estado actual de la base (dentro de la transacción). */
  async computeFingerprint(routineId: string, transaction?: Transaction): Promise<string> {
    const days = await this.dayModel.findAll({
      where: { routineId },
      order: [['order', 'ASC']],
      transaction,
    });
    const exercises = await this.exerciseModel.findAll({
      where: { routineId },
      order: [['order', 'ASC']],
      transaction,
    });
    return routineFingerprint(
      days.map((day) => ({
        weekday: day.weekday,
        exercises: exercises
          .filter((e) => e.routineDayId === day.id)
          .map((e) => ({
            exerciseId: e.exerciseId,
            order: e.order,
            targetSets: e.targetSets,
            repsMin: e.repsMin,
            repsMax: e.repsMax,
          })),
      })),
    );
  }

  async saveFingerprint(routineId: string, fingerprint: string, transaction: Transaction): Promise<void> {
    await this.routineModel.update({ fingerprint }, { where: { id: routineId }, transaction });
  }

  findOverrides(routineId: string): Promise<RoutineWeekOverrideModel[]> {
    return this.overrideModel.findAll({ where: { routineId }, order: [['weekNumber', 'ASC']] });
  }

  async upsertOverride(routineId: string, weekNumber: number, input: WeekOverrideInput) {
    await this.overrideModel.upsert({
      routineId,
      weekNumber,
      isDeload: input.isDeload,
      volumeFactor: input.volumeFactor.toFixed(2),
      loadFactor: input.loadFactor.toFixed(2),
      note: input.note,
    });
  }

  deleteOverride(routineId: string, weekNumber: number): Promise<number> {
    return this.overrideModel.destroy({ where: { routineId, weekNumber } });
  }
}
