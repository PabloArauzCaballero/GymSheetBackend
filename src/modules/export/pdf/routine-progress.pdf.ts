import type { RoutineProgressRow } from '../routine-progress.types';
import { renderPdf, type PdfLayout } from './document';
import { formatDateRange, formatMinutes, formatNumber, humanize } from './format';
import { drawCoverHeader } from './header';
import { drawBarList, drawKpiGrid } from './kpi';
import { MAX_PDF_SETS, SetBudget, truncationNote } from './limits';
import { OVERLOAD_COLUMNS, overloadRows, PLAN_COLUMNS, planRows, SET_COLUMNS, setRows } from './routine-progress.rows';
import {
  computeMuscleDistribution,
  computeOverload,
  computeRoutineProgressStats,
  groupByRoutine,
  prescriptions,
  setsBySession,
  type RoutineGroup,
} from './routine-progress.stats';
import {
  drawEmptyNote,
  drawInfoCards,
  drawSectionTitle,
  drawSmallNote,
  drawSubheading,
  smallNoteHeight,
  SUBHEADING_HEIGHT,
} from './section';
import { drawTable, tableLeadHeight } from './table';
import type { PdfBrand } from './theme';

export type RoutineProgressPdfInput = {
  readonly brand: PdfBrand;
  readonly athleteName: string;
  /** Filtro de período tal como lo eligió la persona. */
  readonly periodLabel: string;
  readonly rows: readonly RoutineProgressRow[];
  readonly generatedAt?: Date;
  readonly timeZone?: string;
};

const TITLE = 'Progreso de rutinas';
const DOWNLOAD = 'Excel o CSV';

export function renderRoutineProgressPdf(input: RoutineProgressPdfInput): Promise<Buffer> {
  const { brand, athleteName, generatedAt, timeZone } = input;
  return renderPdf({ brand, title: TITLE, subject: athleteName, generatedAt, timeZone }, (layout) => {
    const tz = layout.ctx.timeZone;
    const stats = computeRoutineProgressStats(input.rows);
    drawCoverHeader(layout.ctx, { eyebrow: 'Informe de rutinas', title: TITLE, subject: athleteName });

    drawInfoCards(layout, [
      { label: 'Atleta', value: athleteName },
      { label: 'Filtro de período', value: input.periodLabel },
      { label: 'Sesiones entre', value: formatDateRange(stats.firstDate, stats.lastDate, tz) },
      { label: 'Rutinas', value: formatNumber(stats.routines) },
    ]);

    drawSectionTitle(layout, 'Resumen', { keepWith: 150 });
    drawKpiGrid(layout, [
      { label: 'Sesiones', value: formatNumber(stats.sessions), hint: 'Con al menos una serie registrada' },
      { label: 'Volumen total', value: formatNumber(stats.volumeKg), unit: 'kg', hint: 'Peso × repeticiones' },
      { label: 'Series', value: formatNumber(stats.sets), hint: `${formatNumber(stats.reps)} repeticiones` },
      {
        label: 'Tiempo entrenado',
        value: formatMinutes(stats.minutes),
        hint: stats.timedSessions > 0 ? `${formatMinutes(stats.minutes / stats.timedSessions)} de media` : 'Sin duración registrada',
      },
      {
        label: 'RIR medio',
        value: stats.averageRir !== null ? formatNumber(stats.averageRir, 1) : '—',
        hint: 'Repeticiones en reserva',
      },
      { label: 'Ejercicios', value: formatNumber(prescriptions(input.rows).length), hint: 'En las rutinas incluidas' },
    ]);
    if (stats.sets > MAX_PDF_SETS) {
      drawSmallNote(
        layout,
        `El resumen cuenta las ${formatNumber(stats.sets)} series. Las tablas de detalle muestran como mucho ${formatNumber(MAX_PDF_SETS)}, por rutina y de la sesión más reciente a la más antigua; el detalle completo está en la descarga en ${DOWNLOAD}.`,
      );
    }

    drawOverload(layout, input.rows);
    drawMuscleDistribution(layout, input.rows);

    const routines = groupByRoutine(input.rows);
    if (routines.length === 0) {
      drawSectionTitle(layout, 'Rutinas');
      drawEmptyNote(layout, 'Sin rutinas ni series en el período seleccionado.');
    }
    const budget = new SetBudget();
    routines.forEach((routine) => drawRoutine(layout, routine, budget));
  });
}

function drawOverload(layout: PdfLayout, rows: readonly RoutineProgressRow[]): void {
  const table = overloadRows(computeOverload(rows));
  drawSectionTitle(layout, 'Sobrecarga progresiva', {
    caption: '1RM estimado (e1RM) al empezar el programa y hoy',
    keepWith: table.length > 0 ? tableLeadHeight(layout, OVERLOAD_COLUMNS, table) : undefined,
  });
  if (table.length === 0) return drawEmptyNote(layout, 'Sin datos de sobrecarga progresiva.');
  drawTable(layout, OVERLOAD_COLUMNS, table);
}

function drawMuscleDistribution(layout: PdfLayout, rows: readonly RoutineProgressRow[]): void {
  const groups = computeMuscleDistribution(rows);
  drawSectionTitle(layout, 'Series por grupo muscular');
  if (groups.length === 0) return drawEmptyNote(layout, 'Sin series registradas por grupo muscular.');
  const total = groups.reduce((sum, g) => sum + g.sets, 0);
  drawBarList(
    layout,
    groups.slice(0, 10).map((g) => ({
      label: humanize(g.group),
      value: g.sets,
      display: `${formatNumber(g.sets)} series · ${Math.round((g.sets / total) * 100)} %`,
    })),
  );
}

function drawRoutine(layout: PdfLayout, routine: RoutineGroup, budget: SetBudget): void {
  const { first, rows } = routine;
  const caption = [
    first.rutina_objetivo ? humanize(first.rutina_objetivo) : null,
    first.rutina_duracion_semanas ? `${first.rutina_duracion_semanas} semanas` : null,
    first.rutina_es_oficial ? 'Oficial REPP' : null,
    first.rutina_autor_nombre ? `Autor: ${first.rutina_autor_nombre}` : null,
  ];
  const plan = planRows(prescriptions(rows));
  const description = first.rutina_descripcion ?? '';
  const lead =
    (description ? smallNoteHeight(layout, description) : 0) +
    SUBHEADING_HEIGHT +
    (plan.length > 0 ? tableLeadHeight(layout, PLAN_COLUMNS, plan) : 22);
  drawSectionTitle(layout, first.rutina_nombre, { caption: caption.filter(Boolean).join(' · '), keepWith: lead });
  if (description) drawSmallNote(layout, description);

  drawSubheading(layout, 'Prescripción', plan.length > 0 ? tableLeadHeight(layout, PLAN_COLUMNS, plan) : 22);
  if (plan.length === 0) drawEmptyNote(layout, 'Sin ejercicios prescritos.');
  else drawTable(layout, PLAN_COLUMNS, plan);

  const sets = setsBySession(rows);
  const shown = sets.slice(0, budget.take(sets.length));
  const table = setRows(shown, layout.ctx.timeZone);
  drawSubheading(layout, 'Series registradas', table.length > 0 ? tableLeadHeight(layout, SET_COLUMNS, table) : 22);
  if (sets.length === 0) return drawEmptyNote(layout, 'Sin series registradas en esta rutina.');
  if (shown.length > 0) drawTable(layout, SET_COLUMNS, table);
  if (shown.length < sets.length) drawSmallNote(layout, truncationNote(shown.length, sets.length, 'series de esta rutina', DOWNLOAD));
}
