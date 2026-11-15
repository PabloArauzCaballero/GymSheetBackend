import type { WorkoutSessionExerciseResponse, WorkoutSessionResponse, WorkoutSetResponse } from '../../workouts/workout.mapper';
import { formatClock, formatDistance, formatKg, formatLongDate, formatMinutes, formatNumber, formatSignedKg, humanize } from './format';
import type { TableColumn, TableRow } from './table';
import { exerciseName, loadDelta, sessionMinutes, setVolumeKg, type ExerciseProgress } from './workout-history.stats';

/** Columnas y filas de las tablas del informe de avance. */

export const PROGRESS_COLUMNS: readonly TableColumn[] = [
  { header: 'Ejercicio', width: 0.28, bold: true },
  { header: 'Sesiones', width: 0.12, align: 'right' },
  { header: 'Series', width: 0.09, align: 'right' },
  { header: 'Mejor serie', width: 0.15, align: 'right' },
  { header: 'Inicial', width: 0.12, align: 'right', muted: true },
  { header: 'Actual', width: 0.12, align: 'right' },
  { header: 'Variación', width: 0.12, align: 'right', bold: true },
];

export function progressRows(progress: readonly ExerciseProgress[]): TableRow[] {
  return progress.map((p) => {
    const delta = loadDelta(p);
    return {
      kind: 'row',
      cells: [
        p.name,
        formatNumber(p.sessions),
        formatNumber(p.sets),
        p.bestSet ? `${p.bestSet.reps} × ${formatKg(p.bestSet.kg)}` : '—',
        delta !== null && p.firstTopKg !== null ? formatKg(p.firstTopKg) : '—',
        p.lastTopKg !== null ? formatKg(p.lastTopKg) : '—',
        delta !== null ? formatSignedKg(delta) : '—',
      ],
    };
  });
}

export const SESSION_COLUMNS: readonly TableColumn[] = [
  { header: 'Ejercicio', width: 0.29, bold: true },
  { header: 'Series', width: 0.09, align: 'right' },
  { header: 'Detalle (reps × carga)', width: 0.39, muted: true },
  { header: 'Volumen', width: 0.13, align: 'right' },
  { header: 'RIR', width: 0.1, align: 'right' },
];

function describeSet(set: WorkoutSetResponse): string {
  if (set.tipoSerie === 'CARDIO') {
    const parts = [set.duracionSeg ? formatClock(set.duracionSeg) : null, set.distanciaM ? formatDistance(set.distanciaM) : null];
    return parts.filter(Boolean).join(' · ') || 'Cardio';
  }
  const reps = set.repeticiones ?? 0;
  return set.pesoKg ? `${reps} × ${formatKg(set.pesoKg)}` : `${reps} reps`;
}

function exerciseRow(entry: WorkoutSessionExerciseResponse): TableRow {
  const sets = [...entry.series].sort((a, b) => a.numeroSerie - b.numeroSerie);
  const rirs = sets.map((s) => s.rir).filter((r): r is number => r !== null && r !== undefined);
  const skipped = entry.saltadas?.length ?? 0;
  let detail = entry.omitido ? 'Omitido' : sets.map(describeSet).join('  ·  ');
  if (skipped > 0) detail += `${detail ? '   ' : ''}(${skipped} ${skipped === 1 ? 'saltada' : 'saltadas'})`;
  const volume = sets.reduce((sum, set) => sum + setVolumeKg(set), 0);
  return {
    kind: 'row',
    cells: [
      entry.esEnfasis ? `${exerciseName(entry)} · Énfasis` : exerciseName(entry),
      formatNumber(sets.length),
      detail,
      volume > 0 ? formatKg(volume) : '—',
      rirs.length > 0 ? formatNumber(rirs.reduce((a, b) => a + b, 0) / rirs.length, 1) : '—',
    ],
  };
}

/** Una sesión: subcabecera con fecha (zona del negocio) y una fila por ejercicio. */
export function sessionRows(session: WorkoutSessionResponse, timeZone: string): TableRow[] {
  const minutes = sessionMinutes(session);
  const volume = session.ejercicios.reduce((sum, e) => sum + e.series.reduce((s, set) => s + setVolumeKg(set), 0), 0);
  const meta = [
    humanize(session.estado),
    minutes !== null ? formatMinutes(minutes) : null,
    volume > 0 ? formatKg(volume) : null,
    session.geoVerificada ? 'Sede verificada' : null,
  ];
  const rows: TableRow[] = [{ kind: 'group', label: formatLongDate(session.fechaInicio, timeZone), meta: meta.filter(Boolean).join(' · ') }];
  const entries = [...session.ejercicios].sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0));
  if (entries.length === 0) rows.push({ kind: 'row', cells: ['Sin ejercicios registrados', ' ', ' ', ' ', ' '] });
  rows.push(...entries.map(exerciseRow));
  if (session.observacion) rows.push({ kind: 'row', cells: ['Nota de la sesión', ' ', session.observacion, ' ', ' '] });
  return rows;
}

export function sessionSetCount(session: WorkoutSessionResponse): number {
  return session.ejercicios.reduce((sum, e) => sum + e.series.length, 0);
}
