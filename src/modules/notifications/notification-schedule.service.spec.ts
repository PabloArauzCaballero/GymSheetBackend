import { NotificationScheduleService } from './notification-schedule.service';

describe('NotificationScheduleService', () => {
  const service = new NotificationScheduleService();

  it('defers an overnight quiet-hour delivery until the window ends', () => {
    const now = new Date('2026-07-19T06:00:00.000Z');

    expect(service.nextAllowedAt(now, '22:00:00', '06:00:00')).toEqual(
      new Date('2026-07-19T10:00:01.000Z'),
    );
  });

  it('defers a daytime quiet-hour delivery until the window ends', () => {
    const now = new Date('2026-07-19T18:00:00.000Z');

    expect(service.nextAllowedAt(now, '13:00:00', '15:00:00')).toEqual(
      new Date('2026-07-19T19:00:01.000Z'),
    );
  });

  it('keeps the current time when outside quiet hours', () => {
    const now = new Date('2026-07-19T16:00:00.000Z');

    expect(service.nextAllowedAt(now, '22:00:00', '06:00:00')).toBe(now);
  });
});
