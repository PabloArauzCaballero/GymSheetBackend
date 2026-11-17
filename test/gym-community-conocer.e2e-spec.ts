import { QueryOptions, QueryTypes } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import { MyGymRepository } from '../src/modules/gym-community/my-gym.repository';
import { bootE2eApp, type E2eApp } from './support/e2e-app';
import { seedConfirmedSocio, seedGymEntity } from './support/gym-community-e2e';

type Member = { token: string; id: string };
type Card = { userId: string; reasons: string[]; gymBadge: { id: string } | null };

/**
 * Conocer and the same gym (ADR-0027): the SAME_GYM reason and weight need
 * both people to be CONFIRMED SOCIOs of the same gym entity, and a member of
 * the viewer's gym is inside the perimeter whatever their tenant. Runs in its
 * own tenant so other suites' members never mix in.
 */
describe('Conocer by confirmed gym (e2e, franja 7c)', () => {
  jest.setTimeout(60000);
  let e2e: E2eApp;
  let sequelize: Sequelize;
  let gymId: string;
  const tenant = `gc-conocer-${Date.now().toString(36)}`;
  const otherTenant = `${tenant}-b`;
  const people: Record<'viewer' | 'mate' | 'plain' | 'pending' | 'faraway' | 'outsider', Member> = {} as never;

  async function member(label: string, gender: 'MALE' | 'FEMALE', tenantId: string): Promise<Member> {
    const account = await e2e.register(label);
    await e2e.sql(`UPDATE public.usuarios SET tenant_id = :tenantId, genero = :gender, last_active_at = now() WHERE id = :id`, { tenantId, gender, id: account.id });
    for (const position of [0, 1]) {
      await e2e.sql(
        `INSERT INTO profile.photos (user_id, url, storage_provider, storage_key, position) VALUES (:id, 'http://localhost/p.jpg', 'local', :key, :position)`,
        { id: account.id, key: `gc-conocer/${account.id}/${position}`, position },
      );
    }
    const api = e2e.as(account.token);
    await api.patch('/me/social-discovery-settings').send({ profileEnabled: true, crossGymEnabled: false, mapEnabled: false, expectedVersion: 0 }).expect(200);
    await api
      .put('/me/discovery/preferences')
      .send({ genders: [gender === 'MALE' ? 'FEMALE' : 'MALE'], intents: ['TRAINING'], minAge: 18, maxAge: 60, radiusKm: 10, flexibleAge: false, flexibleDistance: false, expectedVersion: 0 })
      .expect(200);
    return account;
  }

  const deck = async (): Promise<Map<string, Card>> => {
    const response = await e2e.as(people.viewer.token).get('/me/discovery/deck?limit=20').expect(200);
    return new Map((response.body.data as Card[]).map((card) => [card.userId, card]));
  };

  /** The plan of the statement `run` sends that contains `marker`, with sequential scans off: the index is usable. */
  async function planOf(marker: string, run: () => Promise<unknown>): Promise<string> {
    const spy = jest.spyOn(sequelize, 'query');
    await run();
    const call = spy.mock.calls.find(([sql]) => typeof sql === 'string' && sql.includes(marker));
    spy.mockRestore();
    if (!call) throw new Error(`no statement with ${marker}`);
    const [sql, options] = call as [string, QueryOptions];
    return sequelize.transaction(async (transaction) => {
      // Fresh statistics (other suites wrote affiliations since the last autovacuum), no sequential scans.
      await sequelize.query('ANALYZE directory.affiliations', { transaction });
      await sequelize.query('SET LOCAL enable_seqscan = off', { transaction });
      const rows = await sequelize.query<{ 'QUERY PLAN': string }>(`EXPLAIN ${sql}`, { ...options, type: QueryTypes.SELECT, transaction });
      return rows.map((row) => row['QUERY PLAN']).join('\n');
    });
  }

  beforeAll(async () => {
    e2e = await bootE2eApp();
    sequelize = e2e.app.get(Sequelize);
    for (const id of [tenant, otherTenant]) await e2e.sql(`INSERT INTO tenants (id, nombre) VALUES (:id, :id)`, { id });
    people.viewer = await member('gcc-viewer', 'MALE', tenant);
    people.mate = await member('gcc-mate', 'FEMALE', tenant);
    people.plain = await member('gcc-plain', 'FEMALE', tenant);
    people.pending = await member('gcc-pending', 'FEMALE', tenant);
    people.faraway = await member('gcc-faraway', 'FEMALE', otherTenant);
    people.outsider = await member('gcc-outsider', 'FEMALE', otherTenant);
    gymId = await seedGymEntity(sequelize);
    for (const person of [people.viewer, people.mate, people.faraway]) await seedConfirmedSocio(sequelize, person.id, gymId);
    await e2e.sql(
      `INSERT INTO directory.affiliations (gym_entity_id, user_id, kind, status, location_id, ci_last3)
       SELECT :gymId, :userId, 'SOCIO', 'REQUESTED', l.id, '321' FROM directory.entity_locations l WHERE l.entity_id = :gymId`,
      { gymId, userId: people.pending.id },
    );
  }, 120000);

  afterAll(async () => {
    await e2e?.app.close();
  });

  it('SAME_GYM and the badge only when both are CONFIRMED in the same gym; a gym mate of another tenant is in the deck', async () => {
    const cards = await deck();
    expect([...cards.keys()].sort()).toEqual([people.mate.id, people.plain.id, people.pending.id, people.faraway.id].sort());
    for (const person of [people.mate, people.faraway]) {
      expect(cards.get(person.id)?.reasons).toContain('SAME_GYM');
      expect(cards.get(person.id)?.gymBadge?.id).toBe(gymId);
    }
    for (const person of [people.plain, people.pending]) {
      expect(cards.get(person.id)?.reasons).not.toContain('SAME_GYM');
      expect(cards.get(person.id)?.gymBadge).toBeNull();
    }
    // The weight follows the reason: a gym mate ranks above the same profile without the gym.
    const order = [...cards.keys()];
    expect(order.indexOf(people.mate.id)).toBeLessThan(order.indexOf(people.plain.id));

    await e2e.as(people.viewer.token).post('/me/connections').send({ addresseeId: people.outsider.id }).expect(404);
  });

  it('a member who hides the membership gets no SAME_GYM and no badge; an ended membership loses them all', async () => {
    await e2e.as(people.mate.token).put('/me/gym/visibility').send({ membershipVisible: false }).expect(200);
    let cards = await deck();
    expect(cards.get(people.mate.id)?.reasons).not.toContain('SAME_GYM');
    expect(cards.get(people.mate.id)?.gymBadge).toBeNull();
    await e2e.as(people.mate.token).put('/me/gym/visibility').send({ membershipVisible: true }).expect(200);

    await e2e.sql(
      `UPDATE directory.affiliations SET status = 'ENDED', reason_code = 'LEFT', closed_at = now(), ci_last3 = NULL WHERE user_id = :id AND status = 'CONFIRMED'`,
      { id: people.viewer.id },
    );
    cards = await deck();
    expect(cards.has(people.faraway.id)).toBe(false);
    expect(cards.get(people.mate.id)?.reasons).not.toContain('SAME_GYM');
    expect(cards.get(people.mate.id)?.gymBadge?.id).toBe(gymId);
    await e2e.as(people.viewer.token).get('/me/progression/leaderboard').expect(403);
    await e2e.as(people.viewer.token).post('/me/connections').send({ addresseeId: people.faraway.id }).expect(404);
    // Back in the gym, the mate of another tenant can be liked again.
    await seedConfirmedSocio(sequelize, people.viewer.id, gymId);
    await e2e.as(people.viewer.token).post('/me/connections').send({ addresseeId: people.faraway.id }).expect(201);
  });

  it('the gym ranking and the Conocer gym pool are read from ix_affiliations_gym_confirmed', async () => {
    const repository = e2e.app.get(MyGymRepository);
    const leaderboard = await planOf('progression.user_progress', () => repository.leaderboard(gymId, people.viewer.id, 10, 'points'));
    expect(leaderboard).toContain('ix_affiliations_gym_confirmed');
    const ranking = await planOf('pool AS', () => e2e.as(people.viewer.token).get('/me/discovery/deck?limit=5').expect(200));
    expect(ranking).toContain('ix_affiliations_gym_confirmed');
    expect(ranking).toContain('ux_affiliations_confirmed_socio');
  });
});
