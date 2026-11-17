import { cooldownUntil } from './affiliation.catalog';
import { mapGymAffiliation } from './affiliations.mapper';
import { coachRequestSchema, personRequestSchema, rejectAffiliationSchema } from './affiliations.schemas';

const DAY = 86_400_000;
const gym = '00000000-0000-4000-8000-000000000001';
const location = '00000000-0000-4000-8000-000000000002';

describe('affiliation rules (ADR-0025)', () => {
  it('takes exactly three CI digits, a location for SOCIO and exactly one way to name the gym', () => {
    const ok = { gymEntityId: gym, kind: 'SOCIO', locationId: location, ciLast3: '042' };
    expect(personRequestSchema.safeParse(ok).success).toBe(true);
    for (const ciLast3 of ['42', '1234', 'abc', '12a', ' 123']) expect(personRequestSchema.safeParse({ ...ok, ciLast3 }).success).toBe(false);
    expect(personRequestSchema.safeParse({ ...ok, locationId: undefined }).success).toBe(false);
    expect(personRequestSchema.safeParse({ ...ok, kind: 'ENTRENADOR', locationId: undefined }).success).toBe(true);
    expect(personRequestSchema.safeParse({ ...ok, gymHandle: '@gym' }).success).toBe(false);
    expect(personRequestSchema.safeParse({ ...ok, gymEntityId: undefined }).success).toBe(false);
  });

  it('refuses mass assignment of status, subject or dates (strict schemas)', () => {
    const ok = { gymEntityId: gym, kind: 'SOCIO', locationId: location, ciLast3: '042' };
    for (const extra of [{ status: 'CONFIRMED' }, { userId: gym }, { coachEntityId: gym }, { confirmedAt: '2026-01-01' }]) {
      expect(personRequestSchema.safeParse({ ...ok, ...extra }).success).toBe(false);
    }
    expect(coachRequestSchema.safeParse({ gymHandle: 'gym', kind: 'SOCIO' }).success).toBe(false);
    expect(coachRequestSchema.safeParse({ gymHandle: 'gym', ciLast3: '123' }).success).toBe(false);
    expect(rejectAffiliationSchema.safeParse({ reasonCode: 'NO_LONGER_MEMBER' }).success).toBe(false);
  });

  it('holds a repeat 7 days after the gym said no, 1 day after a withdrawal, never after leaving', () => {
    const now = new Date('2026-11-17T12:00:00Z');
    const ago = (days: number) => new Date(now.getTime() - days * DAY);
    expect(cooldownUntil({ reasonCode: 'CI_MISMATCH', closedAt: ago(6) }, now)).toEqual(new Date(ago(6).getTime() + 7 * DAY));
    expect(cooldownUntil({ reasonCode: 'NO_LONGER_MEMBER', closedAt: ago(8) }, now)).toBeNull();
    expect(cooldownUntil({ reasonCode: 'WITHDRAWN', closedAt: ago(0.5) }, now)).not.toBeNull();
    expect(cooldownUntil({ reasonCode: 'WITHDRAWN', closedAt: ago(2) }, now)).toBeNull();
    for (const reasonCode of ['LEFT', 'SWITCHED_GYM', 'ACCOUNT_CLOSED']) expect(cooldownUntil({ reasonCode, closedAt: now }, now)).toBeNull();
  });

  it('the gym DTO of a person carries only name, main photo, location, dates and the CI digits', () => {
    const dto = mapGymAffiliation({
      id: 'a',
      kind: 'SOCIO',
      status: 'REQUESTED',
      requestedAt: new Date(),
      confirmedAt: null,
      subjectType: 'PERSON',
      personName: 'Ana',
      personPhotoUrl: 'https://cdn.example/p.jpg',
      ciLast3: '123',
      coachName: null,
      coachHandle: null,
      coachLogoUrl: null,
      coachVerified: null,
      locationId: location,
      locationName: 'Centro',
      cursorKey: 'k',
    });
    expect(Object.keys(dto).sort()).toEqual(['confirmedAt', 'id', 'kind', 'location', 'requestedAt', 'status', 'subject']);
    expect(dto.subject).toEqual({ type: 'PERSON', displayName: 'Ana', photoUrl: 'https://cdn.example/p.jpg', ciLast3: '123' });
  });
});
