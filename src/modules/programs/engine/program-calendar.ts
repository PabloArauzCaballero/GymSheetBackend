/**
 * Semanas de un programa sobre el calendario ISO (lunes a domingo), en fechas
 * `YYYY-MM-DD` del gimnasio: nunca la zona del dispositivo (caso límite 4).
 */
const DAY_MS = 86_400_000;

const toUtc = (iso: string): number => Date.parse(`${iso}T00:00:00Z`);
const toIso = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

export const addDays = (iso: string, days: number): string => toIso(toUtc(iso) + days * DAY_MS);

/** ISO: lunes = 1 … domingo = 7. */
export function isoWeekday(iso: string): number {
  const day = new Date(toUtc(iso)).getUTCDay();
  return day === 0 ? 7 : day;
}

export function mondayOf(iso: string): string {
  return addDays(iso, 1 - isoWeekday(iso));
}

export type ProgramWeekSpan = { number: number; startDate: string; endDate: string };

/** Semanas ISO que toca el programa [start, end]; la primera y la última pueden ser parciales. */
export function programWeeks(startDate: string, endDate: string): ProgramWeekSpan[] {
  const weeks: ProgramWeekSpan[] = [];
  let monday = mondayOf(startDate);
  for (let n = 1; toUtc(monday) <= toUtc(endDate); n += 1) {
    weeks.push({ number: n, startDate: monday, endDate: addDays(monday, 6) });
    monday = addDays(monday, 7);
  }
  return weeks;
}

/** Fin previsto: `weeks` semanas completas contadas desde el inicio (inclusive). */
export function plannedEnd(startDate: string, durationWeeks: number): string {
  return addDays(startDate, durationWeeks * 7 - 1);
}

/** Número de semana del programa que contiene `today`, o null si está fuera del rango. */
export function weekNumberOn(today: string, startDate: string, endDate: string): number | null {
  if (toUtc(today) < toUtc(startDate) || toUtc(today) > toUtc(endDate)) return null;
  return programWeeks(startDate, endDate).find((w) => today >= w.startDate && today <= w.endDate)?.number ?? null;
}

/** Sesiones que tocan en una semana: días de la agenda dentro de [inicio, fin] del programa. */
export function sessionsPlannedInWeek(
  week: ProgramWeekSpan,
  weekdays: readonly number[],
  startDate: string,
  endDate: string,
): number {
  let count = 0;
  for (let i = 0; i < 7; i += 1) {
    const day = addDays(week.startDate, i);
    if (day >= startDate && day <= endDate && weekdays.includes(isoWeekday(day))) count += 1;
  }
  return count;
}

/** La agenda de rutinas (`routine_assignments.dias_semana`) usa 0 = domingo; los días de rutina, ISO 1–7. */
export const isoToAgendaDay = (iso: number): number => (iso === 7 ? 0 : iso);
export const agendaToIsoDay = (day: number): number => (day === 0 ? 7 : day);
