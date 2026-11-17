import { daysLeft, periodWindow, shownStatus, targetOf } from './subscription.catalog';

const TODAY = '2026-11-17';
const membership = { offerKind: 'MEMBERSHIP' as const, validityDays: 30, sessionsCount: null };

describe('subscription periods (ADR-0026)', () => {
  it('a first purchase starts today and lasts its validity, both days included', () => {
    expect(periodWindow(membership, TODAY, null)).toEqual({ startsOn: '2026-11-17', endsOn: '2026-12-16', sessionsTotal: null });
  });

  it('a renewal paid early chains the day after the running period ends, never extending it in place', () => {
    expect(periodWindow(membership, TODAY, '2026-11-20')).toEqual({ startsOn: '2026-11-21', endsOn: '2026-12-20', sessionsTotal: null });
    // A chain of renewals keeps chaining: the third period starts after the second.
    expect(periodWindow(membership, TODAY, '2026-12-20').startsOn).toBe('2026-12-21');
    // Renewing on the last day starts tomorrow.
    expect(periodWindow(membership, TODAY, TODAY).startsOn).toBe('2026-11-18');
  });

  it('a lapsed period does not pull the new one into the past', () => {
    expect(periodWindow(membership, TODAY, '2026-10-01').startsOn).toBe(TODAY);
  });

  it('a day pass is one day; a pack without validity has no end; a single session counts one', () => {
    expect(periodWindow({ offerKind: 'DAY_PASS', validityDays: null, sessionsCount: null }, TODAY, null)).toEqual({ startsOn: TODAY, endsOn: TODAY, sessionsTotal: null });
    expect(periodWindow({ offerKind: 'CLASS_PACK', validityDays: null, sessionsCount: 10 }, TODAY, null)).toEqual({ startsOn: TODAY, endsOn: null, sessionsTotal: 10 });
    expect(periodWindow({ offerKind: 'CLASS_PACK', validityDays: 60, sessionsCount: 10 }, TODAY, null).endsOn).toBe('2027-01-15');
    expect(periodWindow({ offerKind: 'SERVICE_SESSION', validityDays: null, sessionsCount: null }, TODAY, null).sessionsTotal).toBe(1);
  });

  it('shows UPCOMING, ACTIVE, EXPIRING (7 days or fewer), EXPIRED and the business decisions', () => {
    const period = (startsOn: string, endsOn: string | null, status = 'ACTIVE') => ({ status, startsOn, endsOn });
    expect(shownStatus(period('2026-11-20', '2026-12-19'), TODAY)).toBe('UPCOMING');
    expect(shownStatus(period('2026-11-01', '2026-12-01'), TODAY)).toBe('ACTIVE');
    expect(shownStatus(period('2026-11-01', '2026-11-24'), TODAY)).toBe('EXPIRING');
    expect(shownStatus(period('2026-11-01', '2026-11-25'), TODAY)).toBe('ACTIVE');
    expect(shownStatus(period('2026-10-01', '2026-11-16'), TODAY)).toBe('EXPIRED');
    expect(shownStatus(period('2026-10-01', null), TODAY)).toBe('ACTIVE');
    expect(shownStatus(period('2026-11-01', '2026-12-01', 'SUSPENDED'), TODAY)).toBe('SUSPENDED');
    expect(shownStatus(period('2026-11-01', '2026-12-01', 'CANCELLED'), TODAY)).toBe('CANCELLED');
    expect(daysLeft({ endsOn: TODAY }, TODAY)).toBe(0);
    expect(daysLeft({ endsOn: '2026-11-24' }, TODAY)).toBe(7);
    expect(daysLeft({ endsOn: null }, TODAY)).toBeNull();
  });

  it('a business cancels or suspends a running period, reactivates a suspended one, and touches nothing ended', () => {
    const running = { status: 'ACTIVE', endsOn: '2026-12-01' };
    expect(targetOf('CANCEL', running, TODAY)).toBe('CANCELLED');
    expect(targetOf('SUSPEND', running, TODAY)).toBe('SUSPENDED');
    expect(targetOf('REACTIVATE', running, TODAY)).toBeNull();
    expect(targetOf('REACTIVATE', { ...running, status: 'SUSPENDED' }, TODAY)).toBe('ACTIVE');
    expect(targetOf('CANCEL', { ...running, status: 'SUSPENDED' }, TODAY)).toBe('CANCELLED');
    expect(targetOf('CANCEL', { ...running, status: 'CANCELLED' }, TODAY)).toBeNull();
    expect(targetOf('CANCEL', { status: 'ACTIVE', endsOn: '2026-11-16' }, TODAY)).toBeNull();
  });
});
