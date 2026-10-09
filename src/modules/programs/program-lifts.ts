import { BadRequestException } from '@nestjs/common';
import { RoutineModel } from '../training/routine.model';
import { defaultIncrementKg } from './engine/double-progression';
import { epley, isGoalReached, workingWeightForGoalWeek } from './engine/strength-goals';
import { LiftTargetInput } from './programs.schemas';
import { ProgramLiftTargetModel } from './program.models';

/** Valores iniciales de los levantamientos de un programa a partir de la rutina y lo que pidió la persona. */
export function buildLiftTargets(input: {
  routine: RoutineModel;
  mode: 'NONE' | 'PROGRESSIVE_OVERLOAD' | 'STRENGTH_GOALS';
  requested: readonly LiftTargetInput[] | undefined;
  startDate: string;
}): Array<Partial<ProgramLiftTargetModel>> {
  if (input.mode === 'NONE') return [];
  const byExercise = new Map<string, RoutineModel['exercises'] extends (infer E)[] | undefined ? E : never>();
  for (const e of [...(input.routine.exercises ?? [])].sort((a, b) => a.order - b.order)) {
    if (!byExercise.has(e.exerciseId)) byExercise.set(e.exerciseId, e);
  }
  const requested = new Map((input.requested ?? []).map((r) => [r.exerciseId, r]));
  for (const id of requested.keys()) {
    if (!byExercise.has(id)) throw new BadRequestException('Un levantamiento no pertenece a la rutina.');
  }

  if (input.mode === 'STRENGTH_GOALS') {
    if (requested.size === 0) throw new BadRequestException('Elige al menos un levantamiento con su meta.');
    return [...requested.values()].map((r) => goalLift(r, byExercise.get(r.exerciseId), input.startDate));
  }

  return [...byExercise.values()].map((e) => {
    const r = requested.get(e.exerciseId);
    const repsMin = r?.repsMin ?? e.repsMin ?? 8;
    const repsMax = Math.max(r?.repsMax ?? e.repsMax ?? Math.max(repsMin, 12), repsMin);
    const weight = r?.workingWeightKg ?? (e.targetWeightKg == null ? 0 : Number(e.targetWeightKg));
    return {
      exerciseId: e.exerciseId,
      workingWeightKg: weight.toFixed(2),
      repsMin,
      repsMax,
      rirTarget: r?.rirTarget ?? e.targetRir ?? null,
      incrementKg: defaultIncrementKg(e.exercise?.muscleGroup).toFixed(2),
      suggestedKg: weight.toFixed(2),
      consecutiveFails: 0,
    };
  });
}

function goalLift(
  r: LiftTargetInput,
  routineExercise: { repsMin: number | null; repsMax: number | null; exercise?: { muscleGroup?: string } | null } | undefined,
  startDate: string,
): Partial<ProgramLiftTargetModel> {
  if (!r.current || r.goalKg == null || !r.goalDate) {
    throw new BadRequestException('Cada meta necesita tu marca actual, la marca objetivo y la fecha.');
  }
  const e1rm = epley(r.current.weightKg, r.current.reps);
  if (isGoalReached(e1rm, r.goalKg)) {
    throw new BadRequestException('La meta debe superar tu marca actual.');
  }
  if (r.goalDate < startDate) throw new BadRequestException('La fecha de la meta no puede ser anterior al inicio.');
  const suggested = workingWeightForGoalWeek(1, e1rm);
  return {
    exerciseId: r.exerciseId,
    workingWeightKg: suggested.toFixed(2),
    repsMin: r.repsMin ?? routineExercise?.repsMin ?? 3,
    repsMax: r.repsMax ?? routineExercise?.repsMax ?? 5,
    rirTarget: r.rirTarget,
    incrementKg: defaultIncrementKg(routineExercise?.exercise?.muscleGroup).toFixed(2),
    suggestedKg: suggested.toFixed(2),
    consecutiveFails: 0,
    initialE1rmKg: e1rm.toFixed(2),
    currentE1rmKg: e1rm.toFixed(2),
    goalKg: r.goalKg.toFixed(2),
    goalDate: r.goalDate,
  };
}
