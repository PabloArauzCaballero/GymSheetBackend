import type { AnthropometricProfileResponse } from '../../profiles/profile.mapper';
import type { WorkoutSessionResponse } from '../../workouts/workout.mapper';
import { renderPdf, type PdfLayout } from './document';
import { formatDateRange, formatMinutes, formatNumber, humanize } from './format';
import { drawCoverHeader } from './header';
import { drawKpiGrid, type KpiItem } from './kpi';
import { SetBudget, truncationNote } from './limits';
import { drawEmptyNote, drawInfoCards, drawSectionTitle, drawSmallNote } from './section';
import { drawTable, tableLeadHeight, type TableRow } from './table';
import type { PdfBrand } from './theme';
import { PROGRESS_COLUMNS, progressRows, SESSION_COLUMNS, sessionRows, sessionSetCount } from './workout-history.rows';
import {
  computeExerciseProgress,
  computeWorkoutHistoryStats,
  loadDelta,
  type ExerciseProgress,
  type WorkoutHistoryStats,
} from './workout-history.stats';

export type WorkoutHistoryPdfInput = {
  readonly brand: PdfBrand;
  readonly athleteName: string;
  readonly profile: AnthropometricProfileResponse | null;
  readonly sessions: readonly WorkoutSessionResponse[];
  readonly generatedAt?: Date;
  readonly timeZone?: string;
};

const TITLE = 'Avance de entrenamiento';

export function renderWorkoutHistoryPdf(input: WorkoutHistoryPdfInput): Promise<Buffer> {
  const { brand, athleteName, generatedAt, timeZone } = input;
  return renderPdf({ brand, title: TITLE, subject: athleteName, generatedAt, timeZone }, (layout) => {
    const tz = layout.ctx.timeZone;
    const stats = computeWorkoutHistoryStats(input.sessions, tz);
    const progress = computeExerciseProgress(input.sessions);
    drawCoverHeader(layout.ctx, { eyebrow: 'Informe de entrenamiento', title: TITLE, subject: athleteName });

    drawInfoCards(layout, [
      { label: 'Atleta', value: athleteName },
      { label: 'Objetivo', value: humanize(input.profile?.objetivo) },
      { label: 'Perfil', value: profileLine(input.profile) },
      { label: 'Período', value: formatDateRange(stats.firstDate, stats.lastDate, tz) },
    ]);

    drawSectionTitle(layout, 'Resumen', { caption: 'Solo sesiones finalizadas', keepWith: 150 });
    drawKpiGrid(layout, summaryKpis(stats, progress));

    const progressTable = progressRows(progress);
    drawSectionTitle(layout, 'Progreso por ejercicio', {
      caption: 'Carga máxima de la primera y la última sesión con carga',
      keepWith: progressTable.length > 0 ? tableLeadHeight(layout, PROGRESS_COLUMNS, progressTable) : undefined,
    });
    if (progressTable.length === 0) drawEmptyNote(layout, 'Sin ejercicios registrados.');
    else drawTable(layout, PROGRESS_COLUMNS, progressTable);

    drawSessionHistory(layout, input.sessions);
  });
}

function summaryKpis(stats: WorkoutHistoryStats, progress: readonly ExerciseProgress[]): KpiItem[] {
  const tracked = progress.filter((p) => loadDelta(p) !== null);
  const improved = tracked.filter((p) => (loadDelta(p) ?? 0) > 0).length;
  return [
    { label: 'Sesiones finalizadas', value: formatNumber(stats.finishedSessions), hint: sessionsHint(stats) },
    { label: 'Volumen total', value: formatNumber(stats.totalVolumeKg), unit: 'kg', hint: 'Peso × repeticiones' },
    { label: 'Series', value: formatNumber(stats.totalSets), hint: `${formatNumber(stats.totalReps)} repeticiones` },
    {
      label: 'Tiempo entrenado',
      value: formatMinutes(stats.totalMinutes),
      hint: stats.timedSessions > 0 ? `${formatMinutes(stats.totalMinutes / stats.timedSessions)} de media por sesión` : 'Sin duración registrada',
    },
    {
      label: 'Racha más larga',
      value: formatNumber(stats.longestWeekStreak),
      unit: stats.longestWeekStreak === 1 ? 'semana' : 'semanas',
      hint: 'Semanas seguidas entrenando',
    },
    tracked.length > 0
      ? { label: 'Ejercicios con mejora', value: formatNumber(improved), unit: `de ${formatNumber(tracked.length)}`, hint: 'Más carga que en su primera sesión' }
      : { label: 'Ejercicios con mejora', value: '—', hint: 'Hace falta repetir un ejercicio con carga' },
  ];
}

function sessionsHint(stats: WorkoutHistoryStats): string {
  if (stats.otherSessions === 1) return 'Y 1 en curso o cancelada';
  if (stats.otherSessions > 1) return `Y ${formatNumber(stats.otherSessions)} en curso o canceladas`;
  return stats.finishedSessions > 0 ? 'Todas las registradas' : 'Sin sesiones registradas';
}

function profileLine(profile: AnthropometricProfileResponse | null): string {
  if (!profile) return '—';
  return `${formatNumber(profile.pesoKg, 1)} kg · ${formatNumber(profile.estaturaCm)} cm`;
}

function drawSessionHistory(layout: PdfLayout, sessions: readonly WorkoutSessionResponse[]): void {
  const ordered = [...sessions].sort((a, b) => new Date(b.fechaInicio).getTime() - new Date(a.fechaInicio).getTime());
  const budget = new SetBudget();
  const rows: TableRow[] = [];
  let shownSessions = 0;
  for (const session of ordered) {
    if (budget.remaining === 0) break;
    budget.take(sessionSetCount(session));
    rows.push(...sessionRows(session, layout.ctx.timeZone));
    shownSessions += 1;
  }

  drawSectionTitle(layout, 'Historial de sesiones', {
    caption: ordered.length > 0 ? `${formatNumber(ordered.length)} ${ordered.length === 1 ? 'sesión' : 'sesiones'} · de la más reciente a la más antigua` : undefined,
    keepWith: rows.length > 0 ? tableLeadHeight(layout, SESSION_COLUMNS, rows) : undefined,
  });
  if (ordered.length === 0) return drawEmptyNote(layout, 'Sin sesiones registradas.');
  // El recorte se avisa antes de la tabla: quien lee no tiene que llegar al final para saberlo.
  if (shownSessions < ordered.length) {
    drawSmallNote(layout, truncationNote(shownSessions, ordered.length, 'sesiones (las más recientes)', 'CSV'));
    layout.y += 6;
  }
  drawTable(layout, SESSION_COLUMNS, rows);
}
