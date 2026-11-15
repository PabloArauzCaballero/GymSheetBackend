import type { RoutineProgressRow } from '../routine-progress.types';
import { formatKg, formatLongDate, formatMinutes, formatSignedKg, humanize } from './format';
import { num, type OverloadEntry } from './routine-progress.stats';
import type { TableColumn, TableRow } from './table';

/** Columnas y filas de las tablas del informe de progreso de rutinas. */

export const OVERLOAD_COLUMNS: readonly TableColumn[] = [
  { header: 'Ejercicio', width: 0.22, bold: true },
  { header: 'Programa', width: 0.2, muted: true },
  { header: 'Inicial', width: 0.1, align: 'right', muted: true },
  { header: 'Actual', width: 0.1, align: 'right' },
  { header: 'Variación', width: 0.12, align: 'right', bold: true },
  { header: 'Meta', width: 0.1, align: 'right' },
  { header: 'Peso trabajo', width: 0.16, align: 'right' },
];

export function overloadRows(entries: readonly OverloadEntry[]): TableRow[] {
  return entries.map((e) => ({
    kind: 'row',
    cells: [
      e.exercise,
      [e.routine, e.lane ? humanize(e.lane) : null].filter(Boolean).join(' · '),
      formatKg(e.initialKg),
      formatKg(e.currentKg),
      formatSignedKg(e.currentKg - e.initialKg),
      e.goalKg !== null ? formatKg(e.goalKg) : '—',
      e.workingKg !== null ? formatKg(e.workingKg) : '—',
    ],
  }));
}

export const PLAN_COLUMNS: readonly TableColumn[] = [
  { header: 'Ejercicio', width: 0.28, bold: true },
  { header: 'Grupo muscular', width: 0.17, muted: true },
  { header: 'Series × reps', width: 0.15, align: 'right' },
  { header: 'Peso objetivo', width: 0.17, align: 'right' },
  { header: 'RIR', width: 0.08, align: 'right' },
  { header: 'Descanso', width: 0.15, align: 'right' },
];

/** Prescripción agrupada por día. */
export function planRows(plan: readonly RoutineProgressRow[]): TableRow[] {
  const rows: TableRow[] = [];
  let day: string | null = null;
  for (const row of plan) {
    const key = row.dia_id ?? '';
    if (key !== day) {
      day = key;
      const label = [row.dia_orden ? `Día ${row.dia_orden}` : null, row.dia_nombre].filter(Boolean).join(' · ') || 'Día sin nombre';
      rows.push({ kind: 'group', label, meta: row.dia_semana_nombre || undefined });
    }
    const target = num(row.prescripcion_peso_objetivo_kg);
    const reps = row.prescripcion_reps_rango ?? (row.prescripcion_reps_min ? String(row.prescripcion_reps_min) : '—');
    rows.push({
      kind: 'row',
      cells: [
        row.ejercicio_nombre ?? 'Ejercicio sin nombre',
        humanize(row.ejercicio_grupo_muscular),
        row.prescripcion_series ? `${row.prescripcion_series} × ${reps}` : '—',
        target !== null ? formatKg(target) : '—',
        row.prescripcion_rir_objetivo !== null && row.prescripcion_rir_objetivo !== undefined ? String(row.prescripcion_rir_objetivo) : '—',
        row.prescripcion_descanso_seg ? `${row.prescripcion_descanso_seg} s` : '—',
      ],
    });
  }
  return rows;
}

export const SET_COLUMNS: readonly TableColumn[] = [
  { header: 'Ejercicio', width: 0.34, bold: true },
  { header: 'Serie', width: 0.1, align: 'right', muted: true },
  { header: 'Reps', width: 0.11, align: 'right' },
  { header: 'Peso', width: 0.15, align: 'right' },
  { header: 'Volumen', width: 0.17, align: 'right' },
  { header: 'RIR', width: 0.13, align: 'right' },
];

/** Series registradas agrupadas por sesión; fechas en la zona del negocio. */
export function setRows(sets: readonly RoutineProgressRow[], timeZone: string): TableRow[] {
  const rows: TableRow[] = [];
  let session: string | null | undefined;
  for (const set of sets) {
    if (set.sesion_id !== session) {
      session = set.sesion_id;
      const minutes = num(set.sesion_duracion_min);
      const meta = [
        set.sesion_estado ? humanize(set.sesion_estado) : null,
        minutes ? formatMinutes(minutes) : null,
        set.sesion_geo_verificada ? 'Sede verificada' : null,
      ];
      const label = set.sesion_fecha_inicio ? formatLongDate(set.sesion_fecha_inicio, timeZone) : 'Sesión sin fecha';
      rows.push({ kind: 'group', label, meta: meta.filter(Boolean).join(' · ') });
    }
    const weight = num(set.serie_peso_levantado_kg);
    const volume = num(set.serie_volumen_kg);
    rows.push({
      kind: 'row',
      cells: [
        set.ejercicio_nombre ?? 'Ejercicio sin nombre',
        `#${set.serie_numero ?? '—'}`,
        set.serie_repeticiones_logradas !== null && set.serie_repeticiones_logradas !== undefined ? String(set.serie_repeticiones_logradas) : '—',
        weight !== null ? formatKg(weight) : '—',
        volume !== null ? formatKg(volume) : '—',
        set.serie_rir_real !== null && set.serie_rir_real !== undefined ? String(set.serie_rir_real) : '—',
      ],
    });
  }
  return rows;
}
