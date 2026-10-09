/**
 * Diferencia entre lo planeado en el día de la rutina y lo que se hizo (RF-20).
 * Devuelve una propuesta con la misma forma que `POST /workouts/:id/apply-to-routine`
 * para que el cliente la reenvíe tal cual si la persona acepta.
 */
export type PlannedExercise = {
  routineExerciseId: string;
  exerciseId: string;
  targetSets: number;
  targetWeightKg: number | null;
};

export type PerformedExercise = {
  exerciseId: string;
  sets: ReadonlyArray<{ reps: number; weightKg: number }>;
};

export type RoutineChangeProposal = {
  cambios: Array<{ routineExerciseId: string; pesoObjetivoKg?: number; seriesObjetivo?: number }>;
  agregar: Array<{ ejercicioId: string; seriesObjetivo: number; pesoObjetivoKg?: number }>;
  quitar: string[];
};

/** Peso más repetido entre las series; en empate, el más alto. 0 si todas son sin carga. */
export function modalWeight(sets: ReadonlyArray<{ weightKg: number }>): number {
  const counts = new Map<number, number>();
  for (const s of sets) counts.set(s.weightKg, (counts.get(s.weightKg) ?? 0) + 1);
  let best = 0;
  let bestCount = 0;
  for (const [weight, count] of counts) {
    if (count > bestCount || (count === bestCount && weight > best)) {
      best = weight;
      bestCount = count;
    }
  }
  return best;
}

export function diffAgainstRoutine(
  planned: readonly PlannedExercise[],
  performed: readonly PerformedExercise[],
): RoutineChangeProposal {
  const proposal: RoutineChangeProposal = { cambios: [], agregar: [], quitar: [] };
  const done = new Map(performed.filter((p) => p.sets.length > 0).map((p) => [p.exerciseId, p]));
  const plannedIds = new Set(planned.map((p) => p.exerciseId));

  for (const plan of planned) {
    const actual = done.get(plan.exerciseId);
    if (!actual) {
      // Si no se hizo nada de la rutina no proponemos quitarla toda: sería una sesión vacía.
      if (done.size > 0) proposal.quitar.push(plan.routineExerciseId);
      continue;
    }
    const change: RoutineChangeProposal['cambios'][number] = { routineExerciseId: plan.routineExerciseId };
    if (actual.sets.length !== plan.targetSets) change.seriesObjetivo = actual.sets.length;
    const weight = modalWeight(actual.sets);
    if (weight > 0 && weight !== plan.targetWeightKg) change.pesoObjetivoKg = weight;
    if (change.seriesObjetivo !== undefined || change.pesoObjetivoKg !== undefined) proposal.cambios.push(change);
  }

  for (const [exerciseId, actual] of done) {
    if (plannedIds.has(exerciseId)) continue;
    const weight = modalWeight(actual.sets);
    proposal.agregar.push({
      ejercicioId: exerciseId,
      seriesObjetivo: actual.sets.length,
      ...(weight > 0 ? { pesoObjetivoKg: weight } : {}),
    });
  }
  return proposal;
}

export const hasChanges = (p: RoutineChangeProposal): boolean =>
  p.cambios.length + p.agregar.length + p.quitar.length > 0;

/** Puntos base de una sesión (fórmula de la Senda): 50 + 2 por serie + kg/100. */
export function sessionBasePoints(sets: number, totalKg: number): number {
  return 50 + 2 * sets + Math.floor(totalKg / 100);
}
