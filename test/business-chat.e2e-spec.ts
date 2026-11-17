/* eslint-disable @typescript-eslint/no-unsafe-return -- supertest types response bodies as `any`. */
import { randomUUID } from 'node:crypto';
import { QueryTypes } from 'sequelize';
import { businessConversationsMigration } from '../src/database/migrations/202611200701-business-conversations';
import { KycBusiness, KycHarness, bootKycHarness } from './support/kyc-e2e';
import { registerModerator, type Member } from './support/moderation-e2e';

/** The summary keys of `/me/conversations`: what either side can learn about the other. */
const SUMMARY_KEYS = [
  'businessEntityId', 'canWrite', 'conversationId', 'disappearingSeconds', 'kind', 'lastMessage', 'lastMessageAt', 'nickname',
  'otherUserId', 'otherUserLastDeliveredAt', 'otherUserLastReadAt', 'otherUserLastSeenAt', 'otherUserName', 'otherUserOnline',
  'otherUserPhotoUrl', 'otherUserReadReceiptsSinceAt', 'systemKind',
];

describe('chat with businesses (e2e, franja 8f, ADR-0023)', () => {
  let h: KycHarness;
  let shop: KycBusiness;
  let rival: KycBusiness;
  let draft: KycBusiness;
  let person: Member;
  let stranger: Member;
  let conversationId: string;

  const open = (token: string, entityId: string) => h.e2e.as(token).post('/me/business-conversations').send({ entityId });
  const send = (token: string, id: string, body: object) => h.e2e.as(token).post(`/me/conversations/${id}/messages`).send(body);
  const listOf = async (token: string) => (await h.e2e.as(token).get('/me/conversations').expect(200)).body.data as Record<string, unknown>[];
  const publicBusiness = async (label: string) => {
    const owner = await h.ready(label);
    const submitted = await h.e2e.as(owner.token).post('/business/me/kyc/submit').expect(200);
    expect(submitted.body.data.status).toBe('AUTO_APPROVED');
    return owner;
  };

  beforeAll(async () => {
    h = await bootKycHarness();
    shop = await publicBusiness('chat-shop');
    rival = await publicBusiness('chat-rival');
    draft = await h.business('chat-draft');
    person = await h.e2e.register('chat-person');
    stranger = await h.e2e.register('chat-stranger');
    // The person belongs to a gym; the business account to none: the chat still works across them.
    const gym = `chat-gym-${randomUUID().slice(0, 8)}`;
    await h.e2e.sql('INSERT INTO public.tenants (id, nombre) VALUES (:gym, :gym)', { gym });
    await h.e2e.sql('UPDATE public.usuarios SET tenant_id = :gym WHERE id = :id', { gym, id: person.id });
  }, 120000);

  afterAll(async () => h.close());

  it('a person opens a chat with a public listing without any social connection: 201, then 200 with the same id', async () => {
    const first = await open(person.token, shop.entityId);
    expect([first.status, Object.keys(first.body.data)]).toEqual([201, ['conversationId']]);
    conversationId = first.body.data.conversationId;
    const again = await open(person.token, shop.entityId);
    expect([again.status, again.body.data.conversationId]).toEqual([200, conversationId]);
    const [row] = await h.select<{ kind: string; entity: string; person: string }>(
      'SELECT kind, business_entity_id AS entity, person_user_id AS person FROM chat.conversations WHERE id = :conversationId',
      { conversationId },
    );
    expect(row).toEqual({ kind: 'BUSINESS', entity: shop.entityId, person: person.id });
  });

  it('concurrent openings of the same pair end in one live conversation', async () => {
    const responses = await Promise.all(Array.from({ length: 6 }, () => open(stranger.token, rival.entityId)));
    expect(responses.map((response) => response.status).sort()).toEqual([200, 200, 200, 200, 200, 201]);
    expect(new Set(responses.map((response) => response.body.data.conversationId)).size).toBe(1);
    const live = await h.select<{ id: string }>(
      `SELECT id FROM chat.conversations WHERE kind = 'BUSINESS' AND person_user_id = :id AND revoked_at IS NULL`,
      { id: stranger.id },
    );
    expect(live).toHaveLength(1);
  });

  it('a listing that is not public answers 404 (draft, paused, unknown), and the body never says why', async () => {
    for (const entityId of [draft.entityId, randomUUID()]) {
      const response = await open(person.token, entityId);
      expect([response.status, response.body.detail, response.body.code]).toEqual([404, 'No encontramos ese negocio.', undefined]);
    }
    await h.e2e.sql(`UPDATE directory.entities SET status = 'PAUSED' WHERE id = :id`, { id: rival.entityId });
    expect((await open(person.token, rival.entityId)).status).toBe(404);
    await h.e2e.sql(`UPDATE directory.entities SET status = 'ACTIVE' WHERE id = :id`, { id: rival.entityId });
    expect((await open(person.token, rival.entityId)).status).toBe(201);
  });

  it('a business never opens a chat: 403 ACCOUNT_KIND_NOT_ALLOWED on both doors', async () => {
    const business = await open(shop.token, rival.entityId);
    expect([business.status, business.body.code]).toEqual([403, 'ACCOUNT_KIND_NOT_ALLOWED']);
    const direct = await h.e2e.as(shop.token).post('/me/conversations').send({ otherUserId: person.id });
    expect([direct.status, direct.body.code]).toEqual([403, 'ACCOUNT_KIND_NOT_ALLOWED']);
    const pending = await h.e2e.as(shop.token).get('/me/conversations/pending-replies');
    expect([pending.status, pending.body.code]).toEqual([403, 'ACCOUNT_KIND_NOT_ALLOWED']);
  });

  it('the business answers in the conversation the person opened; each side sees only what it should', async () => {
    await send(person.token, conversationId, { body: '¿Tienen proteína?' }).expect(201);
    const answer = await send(shop.token, conversationId, { body: 'Sí, en la sede central.' }).expect(201);
    expect(answer.body.data).toMatchObject({ senderId: shop.id, conversationId });

    // Last seen is set as if the person had used the app: the business must still not see it.
    await h.e2e.sql('UPDATE public.usuarios SET last_seen_at = now() WHERE id = :id', { id: person.id });
    const [forBusiness] = (await listOf(shop.token)).filter((item) => item.conversationId === conversationId);
    expect(Object.keys(forBusiness).sort()).toEqual(SUMMARY_KEYS);
    expect(forBusiness).toMatchObject({
      kind: 'BUSINESS', businessEntityId: shop.entityId, otherUserId: person.id, otherUserName: 'E2E chat-person',
      otherUserOnline: false, otherUserLastSeenAt: null, disappearingSeconds: null, canWrite: true,
    });
    const [forPerson] = (await listOf(person.token)).filter((item) => item.conversationId === conversationId);
    expect(forPerson).toMatchObject({ kind: 'BUSINESS', businessEntityId: shop.entityId, otherUserId: shop.id, otherUserName: shop.name });
    expect(String(forPerson.otherUserPhotoUrl)).toContain(shop.entityId);

    // The person's social surfaces stay closed to the business.
    for (const path of [`/me/gym-directory/${person.id}`, '/me/social-profile', '/me/connections']) {
      const response = await h.e2e.as(shop.token).get(path);
      expect([path, response.status, response.body.code]).toEqual([path, 403, 'ACCOUNT_KIND_NOT_ALLOWED']);
    }
    const history = (await h.e2e.as(shop.token).get(`/me/conversations/${conversationId}/messages`).expect(200)).body.data;
    expect(history.map((item: { senderId: string }) => item.senderId)).toEqual([person.id, shop.id]);
  });

  it('no disappearing messages and no location in a business chat, for either side (422 with stable codes)', async () => {
    for (const token of [person.token, shop.token]) {
      const timer = await h.e2e.as(token).put(`/me/conversations/${conversationId}/disappearing`).send({ seconds: 86400 });
      expect([timer.status, timer.body.code]).toEqual([422, 'BUSINESS_CHAT_NO_DISAPPEARING']);
      const location = await send(token, conversationId, { type: 'location', locationLat: -16.5, locationLng: -68.15 });
      expect([location.status, location.body.code]).toEqual([422, 'BUSINESS_CHAT_NO_LOCATION']);
    }
    const [row] = await h.select<{ seconds: number | null }>('SELECT disappearing_seconds AS seconds FROM chat.conversations WHERE id = :conversationId', { conversationId });
    expect(row.seconds).toBeNull();
  });

  it('nobody reads or writes a business chat that is not theirs (404)', async () => {
    for (const token of [rival.token, stranger.token]) {
      expect((await h.e2e.as(token).get(`/me/conversations/${conversationId}/messages`)).status).toBe(404);
      expect((await send(token, conversationId, { body: 'hola' })).status).toBe(404);
      expect((await listOf(token)).some((item) => item.conversationId === conversationId)).toBe(false);
    }
    expect((await h.e2e.as(rival.token).post(`/business/me/conversations/${conversationId}/block`)).status).toBe(404);
    const personBlock = await h.e2e.as(person.token).post(`/business/me/conversations/${conversationId}/block`);
    expect([personBlock.status, personBlock.body.code]).toEqual([403, 'ACCOUNT_KIND_NOT_ALLOWED']);
  });

  it('a business REPP suspended stops sending (409 BUSINESS_ACCOUNT_LOCKED); its customer can still write', async () => {
    const strangerChat = (await open(stranger.token, rival.entityId).expect(200)).body.data.conversationId as string;
    await h.e2e.sql(`UPDATE business.accounts SET status = 'SUSPENDED' WHERE user_id = :id`, { id: rival.id });
    try {
      const refused = await send(rival.token, strangerChat, { body: 'Paga por adelantado' });
      expect([refused.status, refused.body.code]).toEqual([409, 'BUSINESS_ACCOUNT_LOCKED']);
      const media = await h.e2e.as(rival.token).post(`/me/conversations/${strangerChat}/messages/media`).field('type', 'image')
        .attach('file', h.logo, { filename: 'qr.png', contentType: 'image/png' });
      expect([media.status, media.body.code]).toEqual([409, 'BUSINESS_ACCOUNT_LOCKED']);
      await send(stranger.token, strangerChat, { body: 'Quiero mi reembolso' }).expect(201);
      expect((await open(person.token, rival.entityId)).status).toBe(404);
    } finally {
      await h.e2e.sql(`UPDATE business.accounts SET status = 'ACTIVE' WHERE user_id = :id`, { id: rival.id });
    }
  });

  it('a report of a business message goes to the REPP queue with its content', async () => {
    const moderator = await registerModerator(h.e2e, 'chat-moderator');
    const text = `Oferta engañosa ${randomUUID()}`;
    const messageId = (await send(shop.token, conversationId, { body: text }).expect(201)).body.data.id as string;
    await h.e2e.as(person.token).post('/me/reports').send({ targetKind: 'CHAT_MESSAGE', targetId: messageId, reason: 'ACOSO' }).expect(201);
    const queue = (await h.e2e.as(moderator.token).get('/admin/moderation/queue').expect(200)).body.data;
    expect(queue).toEqual(expect.arrayContaining([
      expect.objectContaining({ target_kind: 'CHAT_MESSAGE', target_id: messageId, reported_user_id: shop.id, reasons: ['ACOSO'] }),
    ]));
    const kase = await h.e2e.as(moderator.token).get(`/admin/moderation/cases/CHAT_MESSAGE/${messageId}`).expect(200);
    expect(kase.body.data).toMatchObject({ contentUnavailableReason: 'CHAT_EVIDENCE', evidence: { messageId, body: text, senderId: shop.id } });
    // Reporting distances the person from the business (as any 1:1 report); reopen to keep testing.
    conversationId = (await open(person.token, shop.entityId).expect(201)).body.data.conversationId;
  });

  it('the business blocks the person: the conversation is revoked and cannot be reopened (403 BUSINESS_CHAT_BLOCKED)', async () => {
    const blocked = await h.e2e.as(shop.token).post(`/business/me/conversations/${conversationId}/block`).expect(200);
    expect(blocked.body.data).toEqual({ conversationId, blocked: true });
    await h.e2e.as(shop.token).post(`/business/me/conversations/${conversationId}/block`).expect(200);
    expect((await h.e2e.as(person.token).get(`/me/conversations/${conversationId}/messages`)).status).toBe(404);
    expect((await send(shop.token, conversationId, { body: 'hola' })).status).toBe(404);
    const reopen = await open(person.token, shop.entityId);
    expect([reopen.status, reopen.body.code]).toEqual([403, 'BUSINESS_CHAT_BLOCKED']);
    // The block is the business's, not the person's: another business still takes their messages.
    expect([200, 201]).toContain((await open(person.token, rival.entityId)).status);
  });

  it('migration 202611200701 goes down (business chats revoked, columns gone) and up again', async () => {
    const live = (await open(stranger.token, rival.entityId).expect(200)).body.data.conversationId as string;
    const transaction = await h.sequelize.transaction();
    const read = <T extends object>(sql: string) => h.sequelize.query<T>(sql, { type: QueryTypes.SELECT, replacements: { live }, transaction });
    try {
      await businessConversationsMigration.down(h.sequelize.getQueryInterface(), transaction);
      const [row] = await read<{ revoked: boolean; kind: string | null }>(
        `SELECT revoked_at IS NOT NULL AS revoked,
                (SELECT column_name FROM information_schema.columns WHERE table_schema = 'chat' AND table_name = 'conversations' AND column_name = 'kind') AS kind
           FROM chat.conversations WHERE id = :live`,
      );
      expect(row).toEqual({ revoked: true, kind: null });
      expect(await read(`SELECT to_regclass('chat.business_blocks')::text AS t`)).toEqual([{ t: null }]);
      await businessConversationsMigration.up(h.sequelize.getQueryInterface(), transaction);
      expect(await read(`SELECT kind FROM chat.conversations WHERE id = :live`)).toEqual([{ kind: 'DIRECT' }]);
    } finally {
      await transaction.rollback();
    }
  });

  it('10 new business chats per person per day: the 11th answers 429 BUSINESS_CHAT_LIMIT; an existing one still opens', async () => {
    const heavy = await h.e2e.register('chat-heavy');
    // Nine earlier openings today (revoked ones count too, or churn would dodge the limit).
    for (let index = 0; index < 9; index += 1) {
      await h.e2e.sql(
        `INSERT INTO chat.conversations (kind, business_entity_id, person_user_id, revoked_at) VALUES ('BUSINESS', :entity, :person, now())`,
        { entity: rival.entityId, person: heavy.id },
      );
    }
    expect((await open(heavy.token, shop.entityId)).status).toBe(201);
    const eleventh = await open(heavy.token, rival.entityId);
    expect([eleventh.status, eleventh.body.code]).toEqual([429, 'BUSINESS_CHAT_LIMIT']);
    expect((await open(heavy.token, shop.entityId)).status).toBe(200);
    await h.e2e.sql(`UPDATE chat.conversations SET created_at = now() - interval '25 hours' WHERE person_user_id = :id`, { id: heavy.id });
    expect((await open(heavy.token, rival.entityId)).status).toBe(201);
  });
});
