import { QueryTypes } from 'sequelize';
import { gymMembershipVisibilityMigration } from '../src/database/migrations/202611201101-gym-membership-visibility';
import { KycHarness, bootKycHarness } from './support/kyc-e2e';
import { Gym, confirm, gymWithLocations, socioAt } from './support/affiliations-e2e';

type Person = { token: string; id: string };

/**
 * «Mi gimnasio», the gym ranking, the gym member list and the «Socio de X»
 * badge read the CONFIRMED SOCIO affiliation, never `usuarios.tenant_id`
 * (ADR-0027, franja 7c). Every person here shares the default tenant: before
 * 7c that alone put them in the same «gym».
 */
describe('gym community by confirmed affiliation (e2e, franja 7c)', () => {
  let h: KycHarness;
  let gym: Gym;
  let rival: Gym;
  let ana: Person;
  let beto: Person;
  let carla: Person;
  let dani: Person;
  const affiliation: Record<string, string> = {};

  type MyGym = { status: string; membershipVisible: boolean } & Record<string, unknown>;
  const myGym = async (person: Person): Promise<MyGym> => (await h.e2e.as(person.token).get('/me/gym').expect(200)).body.data as MyGym;
  const board = (person: Person) => h.e2e.as(person.token).get('/me/progression/leaderboard?limit=50');
  const boardIds = async (person: Person): Promise<string[]> =>
    ((await board(person).expect(200)).body.data as { userId: string }[]).map((row) => row.userId);
  const memberIds = async (person: Person): Promise<string[]> =>
    ((await h.e2e.as(person.token).get('/me/gym/members').expect(200)).body.data as { userId: string }[]).map((row) => row.userId);
  const badgeOf = async (viewer: Person, target: Person): Promise<{ id: string } | null> =>
    (await h.e2e.as(viewer.token).get(`/me/gym-directory/${target.id}`).expect(200)).body.data.gymBadge as { id: string } | null;
  /** Opens or closes the person's social profile (the badge and the member list need it open). */
  const socialProfile = async (person: Person, profileEnabled: boolean) => {
    const api = h.e2e.as(person.token);
    const { version } = (await api.get('/me/social-discovery-settings').expect(200)).body.data as { version: number };
    await api.patch('/me/social-discovery-settings').send({ profileEnabled, crossGymEnabled: false, mapEnabled: false, expectedVersion: version }).expect(200);
  };
  const points = (person: Person, value: number) =>
    h.e2e.sql('INSERT INTO progression.user_progress (usuario_id, points) VALUES (:id, :value)', { id: person.id, value });

  beforeAll(async () => {
    h = await bootKycHarness();
    gym = await gymWithLocations(h, 'gc-gym');
    rival = await gymWithLocations(h, 'gc-rival');
    // One request at a time: the in-process server resets parallel sockets.
    const people: Person[] = [];
    for (const [label, value] of [['gc-ana', 500], ['gc-beto', 300], ['gc-carla', 900], ['gc-dani', 800]] as const) {
      const person = await h.e2e.register(label);
      await points(person, value);
      await socialProfile(person, true);
      people.push(person);
    }
    [ana, beto, carla, dani] = people;
    for (const [name, person] of [['ana', ana], ['beto', beto]] as const) {
      affiliation[name] = await socioAt(h, person.token, gym);
      await confirm(h, gym, affiliation[name]).expect(200);
    }
    affiliation.carla = await socioAt(h, carla.token, gym, { locationId: gym.locations[1] });
  }, 180000);

  afterAll(async () => h.close());

  it('a CONFIRMED SOCIO sees «Mi gimnasio», the ranking and the members of THAT gym only', async () => {
    const state = await myGym(ana);
    expect(state).toEqual({
      status: 'CONFIRMED',
      gym: { id: gym.entityId, name: gym.name, handle: gym.handle, logoUrl: expect.any(String) },
      location: { id: gym.locations[0], name: expect.any(String) },
      since: expect.any(String),
      affiliationId: affiliation.ana,
      pendingRequest: null,
      membershipVisible: true,
    });
    expect(await boardIds(ana)).toEqual([ana.id, beto.id]);
    const [first] = (await board(ana).expect(200)).body.data;
    expect(first).toMatchObject({ position: 1, isMe: true, points: 500, displayName: 'E2E G.' });
    expect(await memberIds(ana)).toEqual([beto.id]);
  });

  it('REQUESTED is «Solicitud enviada» and no access; same tenant without affiliation is no access either', async () => {
    expect(await myGym(carla)).toMatchObject({
      status: 'REQUESTED',
      gym: null,
      affiliationId: null,
      pendingRequest: { affiliationId: affiliation.carla, gym: { id: gym.entityId }, location: { id: gym.locations[1] }, switchesGym: false },
    });
    expect(await myGym(dani)).toMatchObject({ status: 'NONE', gym: null, pendingRequest: null });
    for (const [person, status] of [[carla, 'REQUESTED'], [dani, 'NONE']] as const) {
      for (const path of ['/me/progression/leaderboard', '/me/gym/members']) {
        const refused = await h.e2e.as(person.token).get(path);
        expect([path, refused.status, refused.body.code, refused.body.details]).toEqual([path, 403, 'GYM_MEMBERSHIP_REQUIRED', { status }]);
      }
    }
    // Their points never reach the gym's ranking or member list.
    const seen = [...(await boardIds(beto)), ...(await memberIds(beto))];
    expect(seen).not.toContain(carla.id);
    expect(seen).not.toContain(dani.id);
  });

  it('the badge is only for a CONFIRMED member of a public gym, and its member can hide it everywhere', async () => {
    expect(await badgeOf(dani, ana)).toEqual({ id: gym.entityId, name: gym.name, handle: gym.handle, logoUrl: expect.any(String) });
    expect(await badgeOf(ana, carla)).toBeNull();
    expect(await badgeOf(ana, dani)).toBeNull();

    const hidden = await h.e2e.as(ana.token).put('/me/gym/visibility').send({ membershipVisible: false }).expect(200);
    expect(hidden.body.data).toMatchObject({ status: 'CONFIRMED', membershipVisible: false });
    expect(await badgeOf(dani, ana)).toBeNull();
    expect(await boardIds(beto)).toEqual([beto.id]);
    expect(await memberIds(beto)).toEqual([]);
    expect(await boardIds(ana)).toEqual([ana.id, beto.id]);
    await h.e2e.as(ana.token).put('/me/gym/visibility').send({ membershipVisible: true }).expect(200);
    // Without a social profile the membership is not shown either; the ranking keeps the place.
    await socialProfile(ana, false);
    expect(await badgeOf(dani, ana)).toBeNull();
    expect(await memberIds(beto)).toEqual([]);
    expect(await boardIds(beto)).toEqual([ana.id, beto.id]);
    await socialProfile(ana, true);
    expect(await badgeOf(dani, ana)).not.toBeNull();
    for (const body of [{}, { membershipVisible: 'no' }, { membershipVisible: true, gymEntityId: rival.entityId }]) {
      await h.e2e.as(ana.token).put('/me/gym/visibility').send(body).expect(400);
    }

    await h.e2e.sql(`UPDATE directory.entities SET status = 'SUSPENDED' WHERE id = :id`, { id: gym.entityId });
    try {
      expect(await badgeOf(dani, ana)).toBeNull();
      expect(await boardIds(ana)).toEqual([ana.id, beto.id]);
    } finally {
      await h.e2e.sql(`UPDATE directory.entities SET status = 'ACTIVE' WHERE id = :id`, { id: gym.entityId });
    }
  });

  it('a business never appears in a ranking, even written as a member; a business never reads one', async () => {
    await h.e2e.sql(
      `INSERT INTO directory.affiliations (gym_entity_id, user_id, kind, status, location_id, ci_last3, confirmed_at)
       VALUES (:gym, :user, 'SOCIO', 'CONFIRMED', :locationId, '999', now())`,
      { gym: gym.entityId, user: rival.id, locationId: gym.locations[0] },
    );
    await h.e2e.sql('INSERT INTO progression.user_progress (usuario_id, points) VALUES (:id, 999999)', { id: rival.id });
    try {
      expect(await boardIds(ana)).not.toContain(rival.id);
      expect(await memberIds(ana)).not.toContain(rival.id);
    } finally {
      await h.e2e.sql(`DELETE FROM directory.affiliations WHERE user_id = :id`, { id: rival.id });
    }
    const asBusiness = await h.e2e.as(gym.token).get('/me/gym');
    expect([asBusiness.status, asBusiness.body.code]).toEqual([403, 'ACCOUNT_KIND_NOT_ALLOWED']);
  });

  it('an ended membership loses everything at once', async () => {
    await h.e2e.as(beto.token).post(`/me/affiliations/${affiliation.beto}/end`).expect(200);
    expect(await myGym(beto)).toMatchObject({ status: 'NONE', gym: null });
    const refused = await board(beto);
    expect([refused.status, refused.body.code]).toEqual([403, 'GYM_MEMBERSHIP_REQUIRED']);
    expect(await boardIds(ana)).toEqual([ana.id]);
    expect(await memberIds(ana)).toEqual([]);
    expect(await badgeOf(ana, beto)).toBeNull();
  });

  it('switching gym moves «Mi gimnasio», the ranking, the members and the badge when the new gym confirms', async () => {
    const switchId = await socioAt(h, ana.token, rival, { switchGym: true });
    expect(await myGym(ana)).toMatchObject({
      status: 'CONFIRMED',
      gym: { id: gym.entityId },
      pendingRequest: { affiliationId: switchId, gym: { id: rival.entityId }, switchesGym: true },
    });
    expect(await boardIds(ana)).toEqual([ana.id]);

    const other = await h.e2e.register('gc-other');
    await points(other, 50);
    await socialProfile(other, true);
    await confirm(h, rival, await socioAt(h, other.token, rival)).expect(200);
    await confirm(h, rival, switchId).expect(200);

    expect(await myGym(ana)).toMatchObject({ status: 'CONFIRMED', gym: { id: rival.entityId }, affiliationId: switchId, pendingRequest: null });
    expect(await boardIds(ana)).toEqual([ana.id, other.id]);
    expect(await memberIds(ana)).toEqual([other.id]);
    expect((await badgeOf(dani, ana))?.id).toBe(rival.entityId);
    expect(await boardIds(other)).toEqual([ana.id, other.id]);
  });

  it('the migration rolls back and forward: the switch goes and comes back shown by default', async () => {
    const queryInterface = h.sequelize.getQueryInterface();
    const transaction = await h.sequelize.transaction();
    const column = async () =>
      (await h.sequelize.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM information_schema.columns
          WHERE table_schema = 'social' AND table_name = 'profile_settings' AND column_name = 'gym_membership_visible'`,
        { type: QueryTypes.SELECT, transaction },
      ))[0].n;
    try {
      await gymMembershipVisibilityMigration.down(queryInterface, transaction);
      expect(await column()).toBe(0);
      await gymMembershipVisibilityMigration.up(queryInterface, transaction);
      expect(await column()).toBe(1);
    } finally {
      await transaction.rollback();
    }
    expect((await myGym(ana)).membershipVisible).toBe(true);
  });
});
