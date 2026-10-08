import { env } from '../../config/env';
import { Injectable, OnModuleInit } from '@nestjs/common';
import { QueryTypes } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import { WorkoutSessionStatus } from '../../common/enums/domain.enums';
import { BusinessDateService } from '../../common/time/business-date.service';
import { RoutineNotifier } from '../training/routine-notifier';
import { TrainingRepository } from '../training/training.repository';
import { SessionFinishedContext, SessionHooksRegistry } from '../workouts/session-hooks';
import { WorkoutsRepository } from '../workouts/workouts.repository';
import { applyDoubleProgression } from './engine/double-progression';
import { weekNumberOn } from './engine/program-calendar';
import { diffAgainstRoutine, hasChanges, sessionBasePoints } from './engine/session-diff';
import { bestE1rm, isGoalReached } from './engine/strength-goals';
import { BONUS_GOAL_REACHED, isSuspiciousSet, sessionQualifies } from './engine/week-close';
import { ProgramsRepository } from './programs.repository';
import { RewardLedgerRepository } from './reward-ledger.repository';

type PerformedSet = { exerciseId: string; reps: number; weightKg: number; rir: number | null };

/** Qué pasa con un programa cuando se termina una sesión que nació de él (RF-15, RF-16, RF-20). */
@Injectable()
export class ProgramSessionService implements OnModuleInit {
  constructor(
    private readonly hooks: SessionHooksRegistry,
    private readonly programs: ProgramsRepository,
    private readonly workouts: WorkoutsRepository,
    private readonly routines: TrainingRepository,
    private readonly notifier: RoutineNotifier,
    private readonly ledger: RewardLedgerRepository,
    private readonly dates: BusinessDateService,
    private readonly sequelize: Sequelize,
  ) {}

  onModuleInit(): void {
    this.hooks.register('programs', (context) => this.onFinished(context));
  }

  async onFinished({ session: finished, userId }: SessionFinishedContext): Promise<Record<string, unknown> | null> {
    if (!finished.programId) return null;
    const program = await this.programs.findById(finished.programId);
    if (!program || program.userId !== userId || program.status !== 'ACTIVE' || !program.routineId) return null;

    const session = await this.workouts.findSessionByIdForUser(finished.id, userId);
    if (!session || session.status !== WorkoutSessionStatus.COMPLETED) return null;

    const performed = this.collectSets(session);
    const today = this.dates.today();
    const weekNumber = weekNumberOn(today, program.startDate, program.plannedEndDate);
    const week = weekNumber ? await this.programs.findWeek(program.id, weekNumber) : null;
    const lifts = await this.programs.listLifts(program.id);
    const doneBefore = week?.sessionsDone ?? 0;

    // Antifraude: las series de más de 3 × el e1RM conocido no cuentan para nada.
    const counted = performed.filter((s) => {
      const lift = lifts.find((l) => l.exerciseId === s.exerciseId);
      return !isSuspiciousSet(s.weightKg, lift?.currentE1rmKg == null ? null : Number(lift.currentE1rmKg));
    });

    const minutes = session.finishedAt ? (session.finishedAt.getTime() - session.startedAt.getTime()) / 60_000 : 0;
    const qualifies = sessionQualifies({ durationMinutes: minutes, strengthSets: counted.length });
    const alreadyCountedToday = qualifies && (await this.countedSessionToday(program.id, session.id, today));
    const counts = qualifies && !alreadyCountedToday;

    const suggestions: Array<Record<string, unknown>> = [];
    const routine = await this.routines.findRoutineById(program.routineId);
    const names = new Map((routine?.exercises ?? []).map((e) => [e.exerciseId, e.exercise?.name ?? null]));

    await this.sequelize.transaction(async (transaction) => {
      if (counts && week) await week.increment('sessionsDone', { transaction });
      for (const lift of lifts) {
        const sets = counted.filter((s) => s.exerciseId === lift.exerciseId);
        if (sets.length === 0) continue;
        if (program.mode === 'PROGRESSIVE_OVERLOAD') {
          const outcome = applyDoubleProgression(
            {
              suggestedKg: Number(lift.suggestedKg),
              incrementKg: Number(lift.incrementKg),
              repsMin: lift.repsMin,
              repsMax: lift.repsMax,
              rirTarget: lift.rirTarget,
              consecutiveFails: lift.consecutiveFails,
            },
            sets,
            { isDeload: week?.isDeload ?? false },
          );
          await lift.update(
            { suggestedKg: outcome.suggestedKg.toFixed(2), consecutiveFails: outcome.consecutiveFails },
            { transaction },
          );
          suggestions.push({
            ejercicioId: lift.exerciseId,
            ejercicioNombre: names.get(lift.exerciseId) ?? null,
            accion: outcome.action,
            pesoSugeridoKg: outcome.suggestedKg,
            mensaje: outcome.message,
          });
        } else if (program.mode === 'STRENGTH_GOALS') {
          const best = bestE1rm(sets);
          if (best != null && best > Number(lift.currentE1rmKg ?? 0)) {
            const reached = !lift.reachedAt && isGoalReached(best, lift.goalKg == null ? null : Number(lift.goalKg));
            await lift.update(
              { currentE1rmKg: best.toFixed(2), ...(reached ? { reachedAt: new Date() } : {}) },
              { transaction },
            );
            suggestions.push({
              ejercicioId: lift.exerciseId,
              ejercicioNombre: names.get(lift.exerciseId) ?? null,
              accion: reached ? 'GOAL_REACHED' : 'E1RM_UP',
              marcaActualKg: Math.round(best * 100) / 100,
              mensaje: reached ? `¡Nueva marca! ${names.get(lift.exerciseId) ?? ''}` : 'Tu marca estimada subió.',
            });
          }
        }
      }
    });

    for (const goal of suggestions.filter((s) => s.accion === 'GOAL_REACHED')) {
      // +300 por meta (D8). Un motivo por levantamiento: no se paga dos veces la misma.
      await this.ledger
        .append({
          userId,
          programId: program.id,
          weekNumber: weekNumber ?? 0,
          multiplier: Number(program.multiplier),
          basePoints: 0,
          bonusPoints: BONUS_GOAL_REACHED,
          reason: `META_ALCANZADA:${String(goal.ejercicioId).replace(/-/gu, '').slice(0, 24)}`,
        })
        .catch(() => false);
      await this.notifier.notify({
        to: userId,
        type: 'GOAL_REACHED',
        subject: '¡Meta alcanzada!',
        body: String(goal.mensaje),
        dedupeKey: `${program.id}:${String(goal.ejercicioId)}`,
        refs: { programId: program.id, exerciseId: String(goal.ejercicioId) },
      }).catch(() => false);
    }

    const proposal = this.proposalFor(routine, session.routineDayId, performed);
    const totalKg = counted.reduce((sum, s) => sum + s.reps * s.weightKg, 0);
    const nextMultiplier = Math.min(Math.round((Number(program.multiplier) + 0.2) * 100) / 100, 2);
    return {
      programa: {
        programId: program.id,
        modo: program.mode,
        semana: weekNumber,
        esDescarga: week?.isDeload ?? false,
        sesionCuenta: counts,
        motivoNoCuenta: counts ? null : this.whyNot(qualifies, alreadyCountedToday),
        sesionesHechasSemana: doneBefore + (counts ? 1 : 0),
        sesionesPlanSemana: week?.sessionsPlan ?? 0,
        bonusModo:
          program.mode === 'NONE'
            ? null
            : {
                multiplicador: Number(program.multiplier),
                proximoMultiplicador: nextMultiplier,
                puntosPrevistos: Math.round(sessionBasePoints(counted.length, totalKg) * (nextMultiplier - 1)),
              },
        sugerencias: suggestions,
        cambiosRespectoRutina: hasChanges(proposal),
        propuesta: proposal,
      },
    };
  }

  private whyNot(qualifies: boolean, alreadyToday: boolean): string {
    if (!qualifies) return 'Para contar necesitas al menos 10 minutos y 3 series.';
    return alreadyToday ? 'Ya contaste una sesión de este programa hoy.' : 'No cuenta.';
  }

  private collectSets(session: NonNullable<Awaited<ReturnType<WorkoutsRepository['findSessionByIdForUser']>>>): PerformedSet[] {
    // Solo series de fuerza: las de cardio no tienen peso ni repeticiones.
    return (session.sessionExercises ?? []).flatMap((se) =>
      (se.sets ?? [])
        .filter((set) => set.type !== 'CARDIO' && set.repetitions != null && set.weightKg != null)
        .map((set) => ({
          exerciseId: se.exerciseId,
          reps: set.repetitions ?? 0,
          weightKg: Number(set.weightKg),
          rir: set.rir,
        })),
    );
  }

  /** Máximo una sesión de fuerza por día y programa cuenta para la semana. */
  private async countedSessionToday(programId: string, sessionId: string, today: string): Promise<boolean> {
    const [row] = await this.sequelize.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM public.sesiones_entrenamiento s
        WHERE s.program_id = :programId AND s.id <> :sessionId AND s.estado = 'FINALIZADA'
          AND (s.fecha_fin AT TIME ZONE :tz)::date = :today::date
          AND (SELECT count(*) FROM public.sesiones_ejercicios se
                 JOIN public.series_entrenamiento st ON st.sesion_ejercicio_id = se.id
                WHERE se.sesion_id = s.id) >= 3`,
      {
        type: QueryTypes.SELECT,
        replacements: { programId, sessionId, today, tz: env.BUSINESS_TIME_ZONE },
      },
    );
    return (row?.n ?? 0) > 0;
  }

  private proposalFor(
    routine: Awaited<ReturnType<TrainingRepository['findRoutineById']>>,
    dayId: string | null,
    performed: readonly PerformedSet[],
  ) {
    const planned = (routine?.exercises ?? [])
      .filter((e) => !dayId || e.routineDayId === dayId)
      .map((e) => ({
        routineExerciseId: e.id,
        exerciseId: e.exerciseId,
        targetSets: e.targetSets,
        targetWeightKg: e.targetWeightKg == null ? null : Number(e.targetWeightKg),
      }));
    const byExercise = new Map<string, Array<{ reps: number; weightKg: number }>>();
    for (const s of performed) byExercise.set(s.exerciseId, [...(byExercise.get(s.exerciseId) ?? []), s]);
    return diffAgainstRoutine(
      planned,
      [...byExercise].map(([exerciseId, sets]) => ({ exerciseId, sets })),
    );
  }
}
