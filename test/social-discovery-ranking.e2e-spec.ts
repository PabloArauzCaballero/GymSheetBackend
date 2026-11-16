import { randomUUID } from 'node:crypto';
import { QueryTypes } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import { bootE2eApp, type E2eApp } from './support/e2e-app';

/**
 * Local "Conocer" ranking (franja 5) end to end against PostgreSQL: deck order,
 * hard filters, reasons/distance, pagination, and the single match model
 * through its three entry points (deck swipe, directory/map connect, likes
 * panel accept). Runs in its own tenant so other suites' members never mix in.
 */
describe('Discovery ranking and single match model (e2e)', () => {
  jest.setTimeout(60000);
  let e2e: E2eApp;
  let sequelize: Sequelize;
  const tenant = `ranking-e2e-${Date.now().toString(36)}`;
  const homeBranch = randomUUID();
  const nearBranch = randomUUID();
  const farBranch = randomUUID();
  type Member = { token: string; id: string };

  async function member(label: string, gender: 'MALE' | 'FEMALE', branchId: string, verified = false): Promise<Member> {
    const account = await e2e.register(label);
    await e2e.sql(
      `UPDATE public.usuarios SET tenant_id = :tenant, genero = :gender, sede_id = :branchId,
              verified_at = CASE WHEN :verified THEN now() ELSE NULL END, last_active_at = now()
        WHERE id = :id`,
      { tenant, gender, branchId, verified, id: account.id },
    );
    for (const position of [0, 1]) {
      await e2e.sql(
        `INSERT INTO profile.photos (user_id, url, storage_provider, storage_key, position)
         VALUES (:id, 'http://localhost/p.jpg', 'local', :key, :position)`,
        { id: account.id, key: `ranking-e2e/${account.id}/${position}`, position },
      );
    }
    const api = e2e.as(account.token);
    await api.patch('/me/social-discovery-settings')
      .send({ profileEnabled: true, crossGymEnabled: false, mapEnabled: false, expectedVersion: 0 })
      .expect(200);
    await api.put('/me/discovery/preferences')
      .send({
        genders: [gender === 'MALE' ? 'FEMALE' : 'MALE'], intents: ['TRAINING'], minAge: 18, maxAge: 60,
        radiusKm: 10, flexibleAge: false, flexibleDistance: false, expectedVersion: 0,
      })
      .expect(200);
    return account;
  }

  const deck = (viewer: Member, query = 'limit=10') => e2e.as(viewer.token).get(`/me/discovery/deck?${query}`).expect(200);
  const deckIds = async (viewer: Member): Promise<string[]> =>
    ((await deck(viewer)).body.data as { userId: string }[]).map((card) => card.userId);

  async function directConversationExists(userA: string, userB: string): Promise<boolean> {
    const rows = await sequelize.query(
      `SELECT 1 FROM chat.participants p1
         JOIN chat.participants p2 ON p2.conversation_id = p1.conversation_id
        WHERE p1.user_id = :userA AND p2.user_id = :userB`,
      { type: QueryTypes.SELECT, replacements: { userA, userB } },
    );
    return rows.length > 0;
  }

  async function connectionStatus(userA: string, userB: string): Promise<string | undefined> {
    const rows = await sequelize.query<{ status: string }>(
      `SELECT status FROM social.connections
        WHERE (requester_id = :userA AND addressee_id = :userB) OR (requester_id = :userB AND addressee_id = :userA)`,
      { type: QueryTypes.SELECT, replacements: { userA, userB } },
    );
    return rows[0]?.status;
  }

  beforeAll(async () => {
    e2e = await bootE2eApp();
    sequelize = e2e.app.get(Sequelize);
    await e2e.sql(`INSERT INTO tenants (id, nombre) VALUES (:tenant, :tenant)`, { tenant });
    const branches: [string, number][] = [[homeBranch, -17.78], [nearBranch, -17.76], [farBranch, -17.28]];
    for (const [id, latitude] of branches) {
      await e2e.sql(
        `INSERT INTO facilities.branches (id, code, name, time_zone, latitude, longitude, tenant_id)
         VALUES (:id, :code, :code, 'America/La_Paz', :latitude, -63.18, :tenant)`,
        { id, code: `rank-${id.slice(0, 8)}`, latitude, tenant },
      );
    }
  }, 60000);

  afterAll(async () => {
    await e2e?.app.close();
  });

  it('orders the deck by the local ranking and pages it without repeats', async () => {
    const viewer = await member('rank-viewer', 'MALE', homeBranch);
    const plain = await member('rank-plain', 'FEMALE', homeBranch);
    const verified = await member('rank-verified', 'FEMALE', homeBranch, true);
    const nearer = await member('rank-nearer', 'FEMALE', nearBranch);
    const far = await member('rank-far', 'FEMALE', farBranch, true);

    const response = await deck(viewer);
    expect(response.headers['x-ranking-config']).toBe('v1');
    const ids = response.body.data.map((card: { userId: string }) => card.userId);
    expect(ids).toEqual([verified.id, plain.id, nearer.id]);
    expect(ids).not.toContain(far.id);
    const [top] = response.body.data;
    expect(top.reasons).toEqual(expect.arrayContaining(['NEARBY', 'VERIFIED']));
    // Presence is a ranking input only: no card ever says someone is online or at the gym now.
    for (const card of response.body.data as Array<{ reasons: string[] }>) {
      expect(card.reasons).not.toContain('ACTIVE_NOW');
      expect(card.reasons).not.toContain('TRAINING_NOW');
    }
    expect(top.distanceKm).toBe(1);
    expect(top.impressionId).toMatch(/^[0-9a-f-]{36}$/u);

    const first = await deck(viewer, 'limit=2');
    const cursor = first.headers['x-next-cursor'];
    expect(cursor).toEqual(expect.any(String));
    const second = await deck(viewer, `limit=2&cursor=${encodeURIComponent(String(cursor))}`);
    const paged = [...first.body.data, ...second.body.data].map((card: { userId: string }) => card.userId);
    expect(paged).toEqual(ids);
    expect(second.headers['x-next-cursor']).toBeUndefined();
  });

  it('turns a mutual like into one accepted connection from every entry point', async () => {
    const viewer = await member('match-viewer', 'MALE', homeBranch);
    const swiper = await member('match-swipe', 'FEMALE', homeBranch);
    const panel = await member('match-panel', 'FEMALE', homeBranch);
    const map = await member('match-map', 'FEMALE', homeBranch);
    const api = e2e.as(viewer.token);

    // Deck swipe: she liked first from the map; her card stays in his deck.
    await e2e.as(swiper.token).post('/me/connections').send({ addresseeId: viewer.id }).expect(201);
    const cards = (await deck(viewer)).body.data as { userId: string; impressionId: string }[];
    const card = cards.find((entry) => entry.userId === swiper.id);
    expect(card).toBeDefined();
    // The impression is optional at decision time and no prior acknowledgement is required.
    const swipe = await api.post('/me/discovery/swipes')
      .send({ targetId: swiper.id, direction: 'LIKE', impressionId: card?.impressionId })
      .expect(201);
    expect(swipe.body.data).toMatchObject({ direction: 'LIKE', matched: true });
    await api.post('/me/discovery/swipes')
      .send({ targetId: swiper.id, direction: 'LIKE', impressionId: card?.impressionId })
      .expect(409);

    // Likes panel: accepting is a LIKE back, and it clears an earlier pass.
    const request = await e2e.as(panel.token).post('/me/connections').send({ addresseeId: viewer.id }).expect(201);
    await e2e.sql(`INSERT INTO social.discovery_passes (viewer_id, target_id) VALUES (:viewer, :panel)`, {
      viewer: viewer.id, panel: panel.id,
    });
    const accepted = await api.patch(`/me/connections/${request.body.data.id}`).send({ action: 'ACCEPT' }).expect(200);
    expect(accepted.body.data.status).toBe('ACCEPTED');
    const passes = await sequelize.query(
      `SELECT 1 FROM social.discovery_passes WHERE viewer_id = :viewer AND target_id = :panel`,
      { type: QueryTypes.SELECT, replacements: { viewer: viewer.id, panel: panel.id } },
    );
    expect(passes).toHaveLength(0);

    // Map/directory connect: two connects are the same match.
    await api.post('/me/connections').send({ addresseeId: map.id }).expect(201);
    const back = await e2e.as(map.token).post('/me/connections').send({ addresseeId: viewer.id }).expect(201);
    expect(back.body.data.status).toBe('ACCEPTED');

    for (const other of [swiper, panel, map]) {
      expect(await connectionStatus(viewer.id, other.id)).toBe('ACCEPTED');
      expect(await directConversationExists(viewer.id, other.id)).toBe(true);
    }
    const remaining = await deckIds(viewer);
    expect(remaining).not.toEqual(expect.arrayContaining([swiper.id, panel.id, map.id]));
    await e2e.as(map.token).post('/me/connections').send({ addresseeId: viewer.id }).expect(409);
  });

  it('keeps the two-sided preference filter', async () => {
    const viewer = await member('pref-viewer', 'MALE', homeBranch);
    const notInterested = await member('pref-other', 'FEMALE', homeBranch);
    await e2e.as(notInterested.token).put('/me/discovery/preferences')
      .send({
        genders: ['FEMALE'], intents: ['TRAINING'], minAge: 18, maxAge: 60,
        radiusKm: 10, flexibleAge: false, flexibleDistance: false, expectedVersion: 1,
      })
      .expect(200);
    expect(await deckIds(viewer)).not.toContain(notInterested.id);
  });
});
