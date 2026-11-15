/** Formato de cifras y fechas en español para los informes PDF. */

/** Separador de miles siempre (es-ES no agrupa las cifras de cuatro dígitos). */
export function formatNumber(value: number, decimals = 0): string {
  const fixed = Math.abs(value).toFixed(decimals);
  const [int, frac] = fixed.split('.');
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const trimmedFrac = frac?.replace(/0+$/, '');
  const sign = value < 0 && Number(fixed) !== 0 ? '-' : '';
  return `${sign}${grouped}${trimmedFrac ? `,${trimmedFrac}` : ''}`;
}

export function formatKg(value: number): string {
  return `${formatNumber(value, value >= 1000 ? 0 : value >= 100 ? 1 : 2)} kg`;
}

export function formatSignedKg(value: number): string {
  if (value === 0) return '0 kg';
  return `${value > 0 ? '+' : '-'}${formatNumber(Math.abs(value), 1)} kg`;
}

/** Minutos a «1 h 05 min» / «45 min». */
export function formatMinutes(totalMinutes: number): string {
  const minutes = Math.round(totalMinutes);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return `${formatNumber(hours)} h ${String(minutes % 60).padStart(2, '0')} min`;
}

/** Segundos a «m:ss» o «h:mm:ss». */
export function formatClock(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

export function formatDistance(meters: number): string {
  return meters >= 1000 ? `${formatNumber(meters / 1000, 2)} km` : `${formatNumber(meters)} m`;
}

/** Zona del negocio por defecto (`env.BUSINESS_TIME_ZONE` la sustituye). */
export const DEFAULT_TIME_ZONE = 'America/La_Paz';

/** Instante → fecha en la zona dada. */
export function formatDate(value: Date | string, timeZone: string): string {
  return new Date(value).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric', timeZone });
}

/** «Domingo, 19 de julio de 2026», en la zona dada. */
export function formatLongDate(value: Date | string, timeZone: string): string {
  const text = new Date(value).toLocaleDateString('es-ES', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone,
  });
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Año calendario del instante en la zona dada. */
function zonedYear(value: Date, timeZone: string): string {
  return value.toLocaleDateString('en-CA', { year: 'numeric', timeZone });
}

export function formatDateRange(from: Date | null, to: Date | null, timeZone: string): string {
  if (!from || !to) return 'Sin registros';
  const b = formatDate(to, timeZone);
  if (formatDate(from, timeZone) === b) return b;
  const sameYear = zonedYear(from, timeZone) === zonedYear(to, timeZone);
  const a = from.toLocaleDateString('es-ES', { day: 'numeric', month: 'short', ...(sameYear ? {} : { year: 'numeric' }), timeZone });
  return `${a} – ${b}`;
}

/** Día calendario del instante en la zona dada, contado desde 1970-01-01. */
export function zonedDayNumber(value: Date, timeZone: string): number {
  const [year, month, day] = value.toLocaleDateString('en-CA', { timeZone }).split('-').map(Number);
  return Math.floor(Date.UTC(year, month - 1, day) / 86400000);
}

/** «PERDIDA_GRASA» → «Perdida grasa»; los valores conocidos con su tilde. */
const LABELS: Record<string, string> = {
  HIPERTROFIA: 'Hipertrofia',
  FUERZA: 'Fuerza',
  RESISTENCIA: 'Resistencia',
  PERDIDA_GRASA: 'Pérdida de grasa',
  SALUD_GENERAL: 'Salud general',
  RENDIMIENTO_DEPORTIVO: 'Rendimiento deportivo',
  REHABILITACION: 'Rehabilitación',
  FINALIZADA: 'Finalizada',
  EN_PROGRESO: 'En curso',
  CANCELADA: 'Cancelada',
  CARDIO: 'Cardio',
};

export function humanize(value: string | null | undefined): string {
  if (!value) return '—';
  if (LABELS[value]) return LABELS[value];
  const text = value.replace(/_/g, ' ').toLowerCase();
  return text.charAt(0).toUpperCase() + text.slice(1);
}
