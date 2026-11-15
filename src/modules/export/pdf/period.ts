import type { RoutineProgressExportQuery } from '../export.schemas';
import { formatDate } from './format';

const PRESETS: Record<string, string> = {
  ALL: 'Todo el historial',
  LAST_30: 'Últimos 30 días',
  LAST_90: 'Últimos 90 días',
  LAST_YEAR: 'Último año',
};

/**
 * Fecha del filtro. Un `AAAA-MM-DD` es un día de calendario, no un instante:
 * se escribe tal cual (en UTC, donde lo deja `Date.parse`) para no correrlo un
 * día hacia atrás en zonas al oeste de Greenwich.
 */
function filterDate(value: string | undefined, timeZone: string): string | null {
  if (!value || Number.isNaN(Date.parse(value))) return null;
  return formatDate(value, /^\d{4}-\d{2}-\d{2}$/.test(value) ? 'UTC' : timeZone);
}

/** El filtro de fechas de la descarga, en palabras. */
export function describeRoutineProgressPeriod(query: Partial<RoutineProgressExportQuery>, timeZone: string): string {
  const from = filterDate(query.dateFrom, timeZone);
  const to = filterDate(query.dateTo, timeZone);
  if (from && to) return `${from} – ${to}`;
  if (from) return `Desde ${from}`;
  if (to) return `Hasta ${to}`;
  return PRESETS[query.datePreset ?? 'ALL'] ?? PRESETS.ALL;
}
