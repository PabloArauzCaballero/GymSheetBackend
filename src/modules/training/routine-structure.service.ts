import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Sequelize } from 'sequelize-typescript';
import { Transaction } from 'sequelize';
import { RoutineVisibility, UserRole } from '../../common/enums/domain.enums';
import { DomainException } from '../../common/errors/domain.exception';
import { generateWeeks } from '../programs/engine/week-generation';
import { ExercisesService } from '../exercises/exercises.service';
import { RoutineNotifier } from './routine-notifier';
import { RoutineAccessService } from './routine-access.service';
import { RoutineDaysRepository } from './routine-days.repository';
import { normalizeDayGroups } from './routine-groups';
import { RoutineDayInput, WeekOverrideInput } from './routine-v2.schemas';
import { RoutineModel } from './routine.model';
import { TrainingRepository } from './training.repository';

type Actor = { id: string; role: UserRole; tenantId?: string };

/** Estructura de una rutina: días, ejercicios, huella, versión, calendario y ajustes de semana. */
@Injectable()
export class RoutineStructureService {
  constructor(
    private readonly days: RoutineDaysRepository,
    private readonly repository: TrainingRepository,
    private readonly access: RoutineAccessService,
    private readonly exercises: ExercisesService,
    private readonly sequelize: Sequelize,
    private readonly notifier: RoutineNotifier,
  ) {}

  /** ROUTINE_HAS_NO_DAYS: al menos un día y todos con ejercicios. */
  assertComplete(days: readonly RoutineDayInput[]): void {
    if (days.length === 0 || days.some((d) => d.exercises.length === 0)) {
      throw new DomainException(
        400,
        'ROUTINE_HAS_NO_DAYS',
        'La rutina necesita al menos un día y cada día al menos un ejercicio.',
      );
    }
  }

  /**
   * Valida y normaliza los bloques (superserie/circuito) de cada día:
   * contiguos, de 2 o más, renumerados y con `grupoTipo` derivado.
   * Lanza 400 ROUTINE_GROUP_INVALID.
   */
  normalizeGroups(days: readonly RoutineDayInput[]): RoutineDayInput[] {
    return days.map((day, index) => ({
      ...day,
      exercises: normalizeDayGroups(day.exercises, day.name ?? `#${index + 1}`),
    }));
  }

  /** Todos los ejercicios deben existir y ser visibles para quien edita (propios o globales). */
  async assertExercisesUsable(
    userId: string,
    days: readonly RoutineDayInput[],
    alreadyInRoutine: ReadonlySet<string> = new Set(),
  ): Promise<void> {
    const ids = new Set(days.flatMap((d) => d.exercises.map((e) => e.exerciseId)));
    for (const id of ids) {
      // Una copia puede traer ejercicios privados de otra persona: ya forman parte de la rutina.
      if (!alreadyInRoutine.has(id)) await this.exercises.getVisibleExerciseOrFail(id, userId);
    }
  }

  async replace(
    actor: Actor,
    routineId: string,
    input: readonly RoutineDayInput[],
  ): Promise<void> {
    const routine = await this.loadRoutine(routineId);
    await this.access.assertCanEdit(actor, routine);
    this.assertComplete(input);
    const days = this.normalizeGroups(input);
    await this.assertExercisesUsable(
      actor.id,
      days,
      new Set((routine.exercises ?? []).map((e) => e.exerciseId)),
    );
    await this.sequelize.transaction(async (transaction) => {
      await this.days.replaceStructure(routineId, days, transaction);
      await this.afterStructureChange(routine, transaction);
    });
    await this.announceNewVersion(routine);
  }

  /** Avisa (una vez al día por copia) a quien tiene una copia de una pública que cambió. */
  async announceNewVersion(routine: RoutineModel): Promise<void> {
    if (routine.visibility !== RoutineVisibility.PUBLIC) return;
    const day = new Date().toISOString().slice(0, 10);
    for (const copy of await this.repository.listCopiesOf(routine.id)) {
      await this.notifier.notify({
        to: copy.createdByUserId,
        type: 'ROUTINE_NEW_VERSION',
        subject: 'Hay una versión nueva',
        body: `Hay una versión nueva de "${routine.name}"`,
        dedupeKey: `${copy.id}:${day}`,
        refs: { routineId: copy.id, sourceId: routine.id },
      });
    }
  }

  /**
   * Tras cualquier cambio de estructura: recalcula la huella y, si la rutina es
   * pública, sube la versión. Si choca con otra pública → ROUTINE_DUPLICATE y se
   * deshace todo el cambio.
   */
  async afterStructureChange(routine: RoutineModel, transaction: Transaction): Promise<void> {
    const fingerprint = await this.days.computeFingerprint(routine.id, transaction);
    try {
      await this.days.saveFingerprint(routine.id, fingerprint, transaction);
      if (routine.visibility === RoutineVisibility.PUBLIC) {
        await routine.increment('version', { transaction });
      }
    } catch (error: unknown) {
      throw await this.translateDuplicate(error, fingerprint);
    }
  }

  async translateDuplicate(error: unknown, fingerprint: string): Promise<unknown> {
    if (!(error instanceof Error) || error.name !== 'SequelizeUniqueConstraintError') return error;
    const text = JSON.stringify((error as { fields?: unknown }).fields ?? {}) + error.message;
    if (!/huella|uq_routines_publicas_huella/u.test(text)) {
      return new ConflictException('El recurso ya existe.');
    }
    const existing = await this.repository.findPublicByFingerprint(fingerprint);
    return new DomainException(409, 'ROUTINE_DUPLICATE', 'Ya existe una rutina pública con los mismos ejercicios.', {
      existingRoutineId: existing?.id ?? null,
    });
  }

  async calendar(actor: Actor, routineId: string, weeks?: number) {
    const routine = await this.loadRoutine(routineId);
    await this.access.assertFullView(actor, routine);
    const [days, overrides] = await Promise.all([
      this.days.findDays(routineId),
      this.days.findOverrides(routineId),
    ]);
    const exercises = routine.exercises ?? [];
    const total = weeks ?? routine.durationWeeks ?? 4;
    const generated = generateWeeks({
      durationWeeks: total,
      progression: routine.progressionConfig,
      overrides: overrides.map((o) => ({
        weekNumber: o.weekNumber,
        isDeload: o.isDeload,
        volumeFactor: Number(o.volumeFactor),
        loadFactor: Number(o.loadFactor),
        note: o.note,
      })),
      days: days.map((day) => ({
        dayId: day.id,
        weekday: day.weekday,
        name: day.name,
        exercises: exercises
          .filter((e) => e.routineDayId === day.id)
          .sort((a, b) => a.order - b.order)
          .map((e) => ({
            routineExerciseId: e.id,
            exerciseId: e.exerciseId,
            order: e.order,
            targetSets: e.targetSets,
            repsMin: e.repsMin,
            repsMax: e.repsMax,
            targetWeightKg: e.targetWeightKg == null ? null : Number(e.targetWeightKg),
            restSeconds: e.restSeconds,
            targetRir: e.targetRir,
            note: e.note,
            group: e.group,
            groupType: e.groupType,
            restBetweenSeconds: e.restBetweenSeconds,
            durationSeconds: e.durationSeconds,
          })),
      })),
    });
    return {
      rutinaId: routine.id,
      duracionSemanas: routine.durationWeeks,
      progresion: routine.progressionConfig,
      semanas: generated,
    };
  }

  async setWeekOverride(actor: Actor, routineId: string, week: number, input: WeekOverrideInput) {
    const routine = await this.loadRoutine(routineId);
    await this.access.assertCanEdit(actor, routine);
    if (routine.durationWeeks != null && week > routine.durationWeeks) {
      throw new BadRequestException('La semana está fuera de la duración de la rutina.');
    }
    await this.days.upsertOverride(routineId, week, input);
    return { semana: week, ...input };
  }

  async clearWeekOverride(actor: Actor, routineId: string, week: number) {
    const routine = await this.loadRoutine(routineId);
    await this.access.assertCanEdit(actor, routine);
    await this.days.deleteOverride(routineId, week);
    return { deleted: true };
  }

  private async loadRoutine(routineId: string): Promise<RoutineModel> {
    const routine = await this.repository.findRoutineById(routineId);
    if (!routine) throw new NotFoundException('Rutina no encontrada.');
    return routine;
  }
}
