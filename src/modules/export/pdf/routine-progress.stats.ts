import type { RoutineProgressRow } from '../routine-progress.types';

/** Cifras del informe de progreso de rutinas. Todo sale de las filas de la vista. */
export type RoutineProgressStats = {
  readonly sessions: number;
  readonly sets: number;
  readonly reps: number;
  readonly volumeKg: number;
  readonly minutes: number;
  /** Sesiones con duración conocida: el divisor de la media. */
  readonly timedSessions: number;
  readonly averageRir: number | null;
  readonly routines: number;
  readonly firstDate: Date | null;
  readonly lastDate: Date | null;
};

export type OverloadEntry = {
  readonly exercise: string;
  /** Rutina y carril del programa: distinguen el mismo ejercicio en dos programas. */
  readonly routine: string;
  readonly lane: string | null;
  readonly initialKg: number;
  readonly currentKg: number;
  readonly goalKg: number | null;
  readonly workingKg: number | null;
};

export type RoutineGroup = {
  readonly first: RoutineProgressRow;
  readonly rows: readonly RoutineProgressRow[];
};

export function num(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function executedSets(rows: readonly RoutineProgressRow[]): RoutineProgressRow[] {
  return rows.filter((row) => row.serie_id);
}

/** Sesiones con al menos una serie registrada; su duración solo si se conoce. */
export function computeRoutineProgressStats(rows: readonly RoutineProgressRow[]): RoutineProgressStats {
  const sets = executedSets(rows);
  const sessionMinutes = new Map<string, number | null>();
  const dates: number[] = [];
  for (const row of sets) {
    if (!row.sesion_id || sessionMinutes.has(row.sesion_id)) continue;
    const minutes = num(row.sesion_duracion_min);
    sessionMinutes.set(row.sesion_id, minutes !== null && minutes > 0 ? minutes : null);
    if (row.sesion_fecha_inicio) dates.push(new Date(row.sesion_fecha_inicio).getTime());
  }
  const timed = [...sessionMinutes.values()].filter((m): m is number => m !== null);
  const rirs = sets.map((row) => num(row.serie_rir_real)).filter((r): r is number => r !== null);
  dates.sort((a, b) => a - b);

  return {
    sessions: sessionMinutes.size,
    sets: sets.length,
    reps: sets.reduce((sum, row) => sum + (num(row.serie_repeticiones_logradas) ?? 0), 0),
    volumeKg: sets.reduce((sum, row) => sum + (num(row.serie_volumen_kg) ?? 0), 0),
    minutes: timed.reduce((sum, m) => sum + m, 0),
    timedSessions: timed.length,
    averageRir: rirs.length > 0 ? rirs.reduce((a, b) => a + b, 0) / rirs.length : null,
    routines: new Set(rows.map((row) => row.rutina_id)).size,
    firstDate: dates.length > 0 ? new Date(dates[0]) : null,
    lastDate: dates.length > 0 ? new Date(dates[dates.length - 1]) : null,
  };
}

/** e1RM inicial y actual del programa, uno por ejercicio que los tenga. */
export function computeOverload(rows: readonly RoutineProgressRow[]): OverloadEntry[] {
  const byExercise = new Map<string, OverloadEntry>();
  for (const row of rows) {
    const initialKg = num(row.sobrecarga_e1rm_inicial_kg);
    const currentKg = num(row.sobrecarga_e1rm_actual_kg);
    const key = `${row.programa_id ?? ''}:${row.ejercicio_id ?? ''}`;
    if (initialKg === null || currentKg === null || !row.ejercicio_id || byExercise.has(key)) continue;
    byExercise.set(key, {
      exercise: row.ejercicio_nombre ?? 'Ejercicio sin nombre',
      routine: row.rutina_nombre,
      lane: row.programa_carril ?? null,
      initialKg,
      currentKg,
      goalKg: num(row.sobrecarga_marca_meta_kg),
      workingKg: num(row.sobrecarga_peso_trabajo_kg),
    });
  }
  return [...byExercise.values()].sort((a, b) => b.currentKg - b.initialKg - (a.currentKg - a.initialKg));
}

/** Series registradas por grupo muscular, de mayor a menor. */
export function computeMuscleDistribution(rows: readonly RoutineProgressRow[]): Array<{ group: string; sets: number }> {
  const counts = new Map<string, number>();
  for (const row of executedSets(rows)) {
    const group = row.ejercicio_grupo_muscular ?? 'Sin grupo';
    counts.set(group, (counts.get(group) ?? 0) + 1);
  }
  return [...counts.entries()].map(([group, sets]) => ({ group, sets })).sort((a, b) => b.sets - a.sets);
}

export function groupByRoutine(rows: readonly RoutineProgressRow[]): RoutineGroup[] {
  const groups = new Map<string, RoutineProgressRow[]>();
  for (const row of rows) {
    const list = groups.get(row.rutina_id) ?? [];
    list.push(row);
    groups.set(row.rutina_id, list);
  }
  return [...groups.values()].map((list) => ({ first: list[0], rows: list }));
}

/** Prescripción única por día y ejercicio, en el orden de la rutina. */
export function prescriptions(rows: readonly RoutineProgressRow[]): RoutineProgressRow[] {
  const seen = new Map<string, RoutineProgressRow>();
  for (const row of rows) {
    if (!row.ejercicio_id) continue;
    const key = `${row.dia_id ?? ''}:${row.ejercicio_id}:${row.ejercicio_orden ?? ''}`;
    if (!seen.has(key)) seen.set(key, row);
  }
  return [...seen.values()].sort(
    (a, b) => (a.dia_orden ?? 0) - (b.dia_orden ?? 0) || (a.ejercicio_orden ?? 0) - (b.ejercicio_orden ?? 0),
  );
}

/** Series registradas, de la sesión más reciente a la más antigua. */
export function setsBySession(rows: readonly RoutineProgressRow[]): RoutineProgressRow[] {
  const time = (row: RoutineProgressRow) => (row.sesion_fecha_inicio ? new Date(row.sesion_fecha_inicio).getTime() : 0);
  return executedSets(rows).sort(
    (a, b) =>
      time(b) - time(a) ||
      (a.sesion_id ?? '').localeCompare(b.sesion_id ?? '') ||
      (a.ejercicio_orden ?? 0) - (b.ejercicio_orden ?? 0) ||
      (a.serie_numero ?? 0) - (b.serie_numero ?? 0),
  );
}
