import { QueryTypes } from 'sequelize';
import { affiliationsMigration } from '../src/database/migrations/202611200901-affiliations';
import { affiliationsClosedRowsMigration } from '../src/database/migrations/202611200901-affiliations-closed-rows';
import { KycHarness, bootKycHarness } from './support/kyc-e2e';
import { Gym, confirm, gymWithLocations, historyOf, noticeKeys, requestAt, socioAt, statusOf } from './support/affiliations-e2e';

describe('affiliations: one gym per SOCIO, the gym switch, concurrency and the closure (e2e, franja 7b)', () => {
  let h: KycHarness;
  let gymA: Gym;
  let gymB: Gym;
  let gymC: Gym;

  beforeAll(async () => {
    h = await bootKycHarness();
    gymA = await gymWithLocations(h, 'int-gym-a');
    gymB = await gymWithLocations(h, 'int-gym-b');
    gymC = await gymWithLocations(h, 'int-gym-c');
  }, 180000);

  afterAll(async () => h.close());

  /** The constraint or index that refused a raw statement, or 'accepted'. */
  const violation = async (statement: string, replacements: Record<string, unknown>): Promise<string> => {
    try {
      await h.e2e.sql(statement, replacements);
      return 'accepted';
    } catch (error: unknown) {
      return String((error as { original?: { constraint?: string } }).original?.constraint);
    }
  };

  it('«cambio de gimnasio»: the request is allowed when asked for, and the old SOCIO ends only when the new gym confirms', async () => {
    const person = await h.e2e.register('int-switch');
    const atA = await socioAt(h, person.token, gymA);
    await confirm(h, gymA, atA).expect(200);

    const plain = await requestAt(h, person.token, { gymEntityId: gymB.entityId, kind: 'SOCIO', locationId: gymB.locations[1], ciLast3: '456' });
    expect([plain.status, plain.body.code, plain.body.details]).toEqual([409, 'SOCIO_OF_ANOTHER_GYM', { affiliationId: atA, action: 'SWITCH_GYM' }]);
    const atB = (await requestAt(h, person.token, { gymEntityId: gymB.entityId, kind: 'SOCIO', locationId: gymB.locations[1], ciLast3: '456', switchGym: true }).expect(201)).body.data;
    expect(atB).toMatchObject({ status: 'REQUESTED', replacesAffiliationId: atA });
    expect((await statusOf(h, atA)).status).toBe('CONFIRMED');
    // A second pending SOCIO request is refused while this one waits.
    const third = await requestAt(h, person.token, { gymEntityId: gymC.entityId, kind: 'SOCIO', locationId: gymC.locations[0], ciLast3: '456', switchGym: true });
    expect([third.status, third.body.code]).toEqual([409, 'AFFILIATION_SOCIO_PENDING']);

    await confirm(h, gymB, atB.id as string).expect(200);
    expect(await statusOf(h, atA)).toMatchObject({ status: 'ENDED', reasonCode: 'SWITCHED_GYM' });
    expect((await statusOf(h, atB.id as string)).status).toBe('CONFIRMED');
    expect(await historyOf(h, atA)).toEqual(['->REQUESTED:', 'REQUESTED>CONFIRMED:', 'CONFIRMED>ENDED:SWITCHED_GYM']);
    expect((await h.e2e.as(gymA.token).get('/business/me/affiliations/members').expect(200)).body.data.items).toEqual([]);
    expect(await noticeKeys(h, person.id)).toEqual(expect.arrayContaining([`affiliation:${atA}:ended`, `affiliation:${atB.id as string}:confirmed`]));
  });

  it('a person is CONFIRMED SOCIO of at most one gym: concurrent requests, concurrent confirmations and the index itself', async () => {
    const person = await h.e2e.register('int-race');
    const body = (gym: Gym) => ({ gymEntityId: gym.entityId, kind: 'SOCIO', locationId: gym.locations[0], ciLast3: '789' });
    const requests = await Promise.all([requestAt(h, person.token, body(gymA)), requestAt(h, person.token, body(gymB))]);
    expect(requests.map((response) => response.status).sort()).toEqual([201, 409]);
    const created = requests.find((response) => response.status === 201)!.body.data as { id: string; gym: { id: string } };
    const gym = created.gym.id === gymA.entityId ? gymA : gymB;

    const confirmations = await Promise.all([confirm(h, gym, created.id), confirm(h, gym, created.id)]);
    expect(confirmations.map((response) => response.status).sort()).toEqual([200, 409]);
    expect(await historyOf(h, created.id)).toEqual(['->REQUESTED:', 'REQUESTED>CONFIRMED:']);

    // Even bypassing the API, the database refuses a second confirmed SOCIO.
    const other = gym === gymA ? gymC : gymA;
    expect(
      await violation(
        `INSERT INTO directory.affiliations (gym_entity_id, user_id, kind, location_id, ci_last3, status, confirmed_at)
         VALUES (:gym, :userId, 'SOCIO', :location, '789', 'CONFIRMED', now())`,
        { gym: other.entityId, userId: person.id, location: other.locations[0] },
      ),
    ).toBe('ux_affiliations_confirmed_socio');
    // ...and a location of another gym, or a coach entity as the gym.
    expect(
      await violation(
        `INSERT INTO directory.affiliations (gym_entity_id, user_id, kind, location_id, ci_last3) VALUES (:gym, :userId, 'ENTRENADOR', :location, '789')`,
        { gym: gymC.entityId, userId: person.id, location: gymA.locations[1] },
      ),
    ).toBe('fk_affiliations_location');
    const coachEntity = await h.select<{ id: string }>(`SELECT id FROM directory.entities WHERE entity_type <> 'GYM' LIMIT 1`);
    if (coachEntity[0]) {
      expect(
        await violation(`INSERT INTO directory.affiliations (gym_entity_id, user_id, kind, ci_last3) VALUES (:gym, :userId, 'ENTRENADOR', '789')`, {
          gym: coachEntity[0].id,
          userId: person.id,
        }),
      ).toBe('fk_affiliations_gym');
    }
    for (const ci of ['12', '12a']) {
      expect(
        await violation(`INSERT INTO directory.affiliations (gym_entity_id, user_id, kind, ci_last3) VALUES (:gym, :userId, 'ENTRENADOR', :ci)`, {
          gym: gymC.entityId,
          userId: person.id,
          ci,
        }),
      ).toBe('ck_affiliations_ci_last3');
    }
  });

  it('a location a live SOCIO declared cannot be deleted (409); once the member ends it can', async () => {
    const person = await h.e2e.register('int-location');
    const id = await socioAt(h, person.token, gymC, { locationId: gymC.locations[1] });
    const refused = await h.e2e.as(gymC.token).del(`/business/me/locations/${gymC.locations[1]}`);
    expect([refused.status, refused.body.code]).toEqual([409, 'LOCATION_IN_USE']);
    await h.e2e.as(person.token).post(`/me/affiliations/${id}/cancel`).expect(200);
    expect(await statusOf(h, id)).toMatchObject({ status: 'CANCELLED', reasonCode: 'WITHDRAWN' });
    await h.e2e.as(gymC.token).del(`/business/me/locations/${gymC.locations[1]}`).expect(204);
    const [row] = await h.select<{ locationId: string | null }>('SELECT location_id AS "locationId" FROM directory.affiliations WHERE id = :id', { id });
    expect(row.locationId).toBeNull();
  });

  it('closing the account ends the affiliations, erases the CI digits and keeps the history without the person', async () => {
    const person = await h.e2e.register('int-closure');
    const confirmed = await socioAt(h, person.token, gymA, { ciLast3: '321' });
    await confirm(h, gymA, confirmed).expect(200);
    const pending = (await requestAt(h, person.token, { gymEntityId: gymB.entityId, kind: 'ENTRENADOR', ciLast3: '321' }).expect(201)).body.data.id as string;

    const preview = (await h.e2e.as(person.token).get('/me/account/closure-preview').expect(200)).body.data;
    expect(preview.anonymized.map((item: { table: string }) => item.table)).toEqual(expect.arrayContaining(['directory.affiliations', 'directory.affiliation_history']));
    await h.e2e.as(person.token).del('/me/account').send({ password: 'e2e-strong-password' }).expect(200);

    expect(await statusOf(h, confirmed)).toEqual({ status: 'ENDED', reasonCode: 'ACCOUNT_CLOSED', ciLast3: null });
    expect(await statusOf(h, pending)).toEqual({ status: 'CANCELLED', reasonCode: 'ACCOUNT_CLOSED', ciLast3: null });
    expect(await historyOf(h, confirmed)).toEqual(['->REQUESTED:', 'REQUESTED>CONFIRMED:', 'CONFIRMED>ENDED:ACCOUNT_CLOSED']);
    const [{ count }] = await h.select<{ count: number }>(
      `SELECT count(*)::int AS count FROM directory.affiliation_history hst JOIN directory.affiliations a ON a.id = hst.affiliation_id
        WHERE a.user_id = :id AND hst.actor_user_id = :id`,
      { id: person.id },
    );
    expect(count).toBe(0);
    const members = (await h.e2e.as(gymA.token).get('/business/me/affiliations/members').expect(200)).body.data.items as { id: string }[];
    expect(members.map((member) => member.id)).not.toContain(confirmed);
  });

  it('migration 202611200901 goes down and up again with rows in place (inside a rolled-back transaction)', async () => {
    const person = await h.e2e.register('int-migration');
    await socioAt(h, person.token, gymC, { locationId: gymC.locations[0] });
    const queryInterface = h.sequelize.getQueryInterface();
    const transaction = await h.sequelize.transaction();
    const tables = async () =>
      (
        await h.sequelize.query<{ affiliations: string | null; history: string | null }>(
          `SELECT to_regclass('directory.affiliations')::text AS affiliations, to_regclass('directory.affiliation_history')::text AS history`,
          { type: QueryTypes.SELECT, transaction },
        )
      )[0];
    try {
      await affiliationsClosedRowsMigration.down(queryInterface, transaction);
      await affiliationsMigration.down(queryInterface, transaction);
      expect(await tables()).toEqual({ affiliations: null, history: null });
      await affiliationsMigration.up(queryInterface, transaction);
      await affiliationsClosedRowsMigration.up(queryInterface, transaction);
      expect(await tables()).toEqual({ affiliations: 'directory.affiliations', history: 'directory.affiliation_history' });
    } finally {
      await transaction.rollback();
    }
    expect((await h.e2e.as(person.token).get('/me/affiliations').expect(200)).body.data.items).toHaveLength(1);
  });
});
