import { BusinessDateService } from './business-date.service';

describe('BusinessDateService', () => {
  const service = new BusinessDateService();

  it('adds calendar days without timezone drift', () => {
    expect(service.addDays('2026-02-28', 1)).toBe('2026-03-01');
    expect(service.addDays('2028-02-28', 1)).toBe('2028-02-29');
  });

  it('computes inclusive business-day distance consistently', () => {
    expect(service.daysBetween('2026-07-19', '2026-07-19')).toBe(0);
    expect(service.daysBetween('2026-07-19', '2026-07-31')).toBe(12);
  });
});
