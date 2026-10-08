import {
  addDays,
  agendaToIsoDay,
  isoToAgendaDay,
  isoWeekday,
  mondayOf,
  plannedEnd,
  programWeeks,
  sessionsPlannedInWeek,
  weekNumberOn,
} from './program-calendar';

describe('calendario del programa', () => {
  it('isoWeekday: lunes = 1, domingo = 7', () => {
    expect(isoWeekday('2026-10-05')).toBe(1);
    expect(isoWeekday('2026-10-11')).toBe(7);
    expect(isoWeekday('2026-10-07')).toBe(3);
  });
  it('mondayOf y addDays cruzan mes y año', () => {
    expect(mondayOf('2026-10-07')).toBe('2026-10-05');
    expect(mondayOf('2026-10-05')).toBe('2026-10-05');
    expect(addDays('2026-12-30', 3)).toBe('2027-01-02');
    expect(mondayOf('2027-01-01')).toBe('2026-12-28');
  });
  it('plannedEnd: 4 semanas desde un lunes terminan en domingo', () => {
    expect(plannedEnd('2026-10-05', 4)).toBe('2026-11-01');
    expect(isoWeekday(plannedEnd('2026-10-05', 4))).toBe(7);
  });
  it('un programa que empieza un lunes tiene exactamente sus semanas', () => {
    const weeks = programWeeks('2026-10-05', plannedEnd('2026-10-05', 4));
    expect(weeks).toHaveLength(4);
    expect(weeks[0]).toEqual({ number: 1, startDate: '2026-10-05', endDate: '2026-10-11' });
  });
  it('empezar un miércoles añade una semana parcial al final (caso límite 2)', () => {
    const start = '2026-10-07';
    const end = plannedEnd(start, 4);
    expect(programWeeks(start, end)).toHaveLength(5);
  });
  it('weekNumberOn devuelve la semana o null fuera del rango', () => {
    const start = '2026-10-05';
    const end = plannedEnd(start, 4);
    expect(weekNumberOn('2026-10-05', start, end)).toBe(1);
    expect(weekNumberOn('2026-10-19', start, end)).toBe(3);
    expect(weekNumberOn('2026-11-01', start, end)).toBe(4);
    expect(weekNumberOn('2026-11-02', start, end)).toBeNull();
    expect(weekNumberOn('2026-10-04', start, end)).toBeNull();
  });
  it('sesiones planeadas: la primera semana parcial solo cuenta los días restantes (caso límite 2)', () => {
    const start = '2026-10-07'; // miércoles
    const end = plannedEnd(start, 4);
    const [first, second] = programWeeks(start, end);
    expect(sessionsPlannedInWeek(first, [1, 3, 5], start, end)).toBe(2); // miércoles y viernes
    expect(sessionsPlannedInWeek(second, [1, 3, 5], start, end)).toBe(3);
  });
  it('sesiones planeadas: la última semana parcial no cuenta días después del fin', () => {
    const start = '2026-10-07';
    const end = plannedEnd(start, 1); // 7 días: miércoles a martes
    const weeks = programWeeks(start, end);
    expect(weeks).toHaveLength(2);
    expect(sessionsPlannedInWeek(weeks[1], [1, 2, 3], start, end)).toBe(2); // lunes y martes
  });
  it('convierte entre la agenda (0 = domingo) y los días ISO', () => {
    expect([1, 2, 3, 4, 5, 6, 7].map(isoToAgendaDay)).toEqual([1, 2, 3, 4, 5, 6, 0]);
    expect([0, 1, 6].map(agendaToIsoDay)).toEqual([7, 1, 6]);
  });
});
