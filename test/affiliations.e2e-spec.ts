import { KycBusiness, KycHarness, bootKycHarness } from './support/kyc-e2e';
import { Gym, confirm, gymWithLocations, noticeKeys, publishedCoach, requestAt, socioAt, statusOf } from './support/affiliations-e2e';

describe('affiliations to a gym: request, confirm, and what the gym sees (e2e, franja 7b)', () => {
  let h: KycHarness;
  let gym: Gym;
  let rival: Gym;
  let coach: KycBusiness;
  let person: { token: string; id: string };
  let stranger: { token: string; id: string };

  beforeAll(async () => {
    h = await bootKycHarness();
    gym = await gymWithLocations(h, 'aff-gym');
    rival = await gymWithLocations(h, 'aff-rival');
    coach = await publishedCoach(h, 'aff-coach');
    person = await h.e2e.register('aff-person');
    stranger = await h.e2e.register('aff-stranger');
    await h.e2e.sql(
      `INSERT INTO profile.photos (user_id, url, storage_provider, storage_key) VALUES (:id, 'https://cdn.example.test/p.jpg', 'local', 'users/' || :id || '/p.jpg')`,
      { id: person.id },
    );
  }, 180000);

  afterAll(async () => h.close());

  it('request → the gym confirms → the person is a member; only three CI digits and nothing else personal reach the gym', async () => {
    const id = await socioAt(h, person.token, gym, { ciLast3: '987' });
    const mine = (await h.e2e.as(person.token).get(`/me/affiliations/${id}`).expect(200)).body.data;
    expect(mine).toMatchObject({ status: 'REQUESTED', kind: 'SOCIO', ciLast3: '987', gym: { id: gym.entityId, handle: gym.handle }, location: { id: gym.locations[0] } });

    const inbox = (await h.e2e.as(gym.token).get('/business/me/affiliations/requests').expect(200)).body.data;
    expect(inbox.pendingCount).toBe(1);
    const [item] = inbox.items;
    expect(Object.keys(item).sort()).toEqual(['confirmedAt', 'id', 'kind', 'location', 'requestedAt', 'status', 'subject']);
    expect(Object.keys(item.subject).sort()).toEqual(['ciLast3', 'displayName', 'photoUrl', 'type']);
    expect(item.subject).toMatchObject({ type: 'PERSON', ciLast3: '987', photoUrl: 'https://cdn.example.test/p.jpg' });
    expect(Object.keys(item.location).sort()).toEqual(['id', 'name']);
    const raw = JSON.stringify(inbox);
    const [{ email }] = await h.select<{ email: string }>('SELECT email FROM public.usuarios WHERE id = :id', { id: person.id });
    for (const secret of [person.id, email, '1995-05-15']) expect(raw).not.toContain(secret);

    expect((await confirm(h, gym, id).expect(200)).body.data).toMatchObject({ status: 'CONFIRMED' });
    const members = (await h.e2e.as(gym.token).get('/business/me/affiliations/members').expect(200)).body.data.items;
    expect(members.map((member: { id: string }) => member.id)).toEqual([id]);
    expect((await h.e2e.as(person.token).get('/me/affiliations').expect(200)).body.data.items[0]).toMatchObject({ id, status: 'CONFIRMED' });
    expect(await noticeKeys(h, gym.id)).toContain(`affiliation:${id}:requested`);
    expect(await noticeKeys(h, person.id)).toContain(`affiliation:${id}:confirmed`);
  });

  it("another gym or another person never finds an affiliation (404), and nothing moves", async () => {
    const [{ id }] = await h.select<{ id: string }>(`SELECT id FROM directory.affiliations WHERE user_id = :id AND status = 'CONFIRMED'`, { id: person.id });
    await h.e2e.as(rival.token).get(`/business/me/affiliations/${id}`).expect(404);
    await confirm(h, rival, id).expect(404);
    await h.e2e.as(rival.token).post(`/business/me/affiliations/${id}/end`).send({ reasonCode: 'CONDUCT' }).expect(404);
    await h.e2e.as(rival.token).post(`/business/me/affiliations/${id}/reject`).send({ reasonCode: 'CI_MISMATCH' }).expect(404);
    expect((await h.e2e.as(rival.token).get('/business/me/affiliations/members').expect(200)).body.data.items).toEqual([]);
    await h.e2e.as(stranger.token).get(`/me/affiliations/${id}`).expect(404);
    await h.e2e.as(stranger.token).post(`/me/affiliations/${id}/end`).expect(404);
    expect((await statusOf(h, id)).status).toBe('CONFIRMED');
  });

  it('a gym that is not public, or a location of another gym, never takes a request', async () => {
    await h.e2e.sql(`UPDATE directory.entities SET status = 'PAUSED' WHERE id = :id`, { id: rival.entityId });
    const paused = await requestAt(h, stranger.token, { gymEntityId: rival.entityId, kind: 'ENTRENADOR', ciLast3: '111' });
    expect(paused.status).toBe(404);
    await requestAt(h, stranger.token, { gymHandle: `@${rival.handle}`, kind: 'ENTRENADOR', ciLast3: '111' }).expect(404);
    await h.e2e.sql(`UPDATE directory.entities SET status = 'ACTIVE' WHERE id = :id`, { id: rival.entityId });
    await requestAt(h, stranger.token, { gymEntityId: coach.entityId, kind: 'ENTRENADOR', ciLast3: '111' }).expect(404);
    const foreign = await requestAt(h, stranger.token, { gymEntityId: rival.entityId, kind: 'SOCIO', locationId: gym.locations[0], ciLast3: '111' });
    expect([foreign.status, foreign.body.code]).toEqual([400, 'AFFILIATION_LOCATION_INVALID']);
    for (const body of [
      { gymEntityId: rival.entityId, kind: 'SOCIO', locationId: rival.locations[0], ciLast3: '1111' },
      { gymEntityId: rival.entityId, kind: 'SOCIO', ciLast3: '111' },
      { gymEntityId: rival.entityId, kind: 'SOCIO', locationId: rival.locations[0], ciLast3: '111', status: 'CONFIRMED' },
    ]) {
      await requestAt(h, stranger.token, body).expect(400);
    }
  });

  it('a person needs a verified email; a business is refused on person routes and the other way round', async () => {
    const unverified = await h.e2e.register('aff-unverified', { verifyEmail: false });
    const refused = await requestAt(h, unverified.token, { gymEntityId: gym.entityId, kind: 'ENTRENADOR', ciLast3: '222' });
    expect([refused.status, refused.body.code]).toEqual([403, 'EMAIL_VERIFICATION_REQUIRED']);
    const asBusiness = await h.e2e.as(gym.token).get('/me/affiliations');
    expect([asBusiness.status, asBusiness.body.code]).toEqual([403, 'ACCOUNT_KIND_NOT_ALLOWED']);
    for (const path of ['/business/me/gym-links', '/business/me/affiliations/requests']) {
      expect((await h.e2e.as(person.token).get(path)).status).toBe(403);
    }
    const gymAsCoach = await h.e2e.as(gym.token).post('/business/me/gym-links').send({ gymHandle: rival.handle });
    expect([gymAsCoach.status, gymAsCoach.body.code]).toEqual([403, 'BUSINESS_TYPE_NOT_ALLOWED']);
    const coachAsGym = await h.e2e.as(coach.token).get('/business/me/affiliations/requests');
    expect([coachAsGym.status, coachAsGym.body.code]).toEqual([403, 'BUSINESS_TYPE_NOT_ALLOWED']);
  });

  it('a coach business links to two gyms by @handle; each gym accepts and sees only its public card', async () => {
    const links: string[] = [];
    for (const target of [gym, rival]) {
      const response = await h.e2e.as(coach.token).post('/business/me/gym-links').send({ gymHandle: `@${target.handle}` }).expect(201);
      expect(response.body.data).toMatchObject({ kind: 'ENTRENADOR', status: 'REQUESTED', ciLast3: null, gym: { id: target.entityId } });
      links.push(response.body.data.id as string);
    }
    const again = await h.e2e.as(coach.token).post('/business/me/gym-links').send({ gymHandle: gym.handle });
    expect([again.status, again.body.code]).toEqual([409, 'AFFILIATION_ALREADY_LIVE']);
    const [request] = (await h.e2e.as(gym.token).get('/business/me/affiliations/requests?kind=ENTRENADOR').expect(200)).body.data.items;
    expect(request.subject).toEqual({ type: 'BUSINESS', name: coach.name, handle: coach.handle, logoUrl: expect.any(String), badge: 'NEW' });
    await confirm(h, gym, links[0]).expect(200);
    await confirm(h, rival, links[1]).expect(200);
    const coaches = (await h.e2e.as(gym.token).get('/business/me/affiliations/coaches').expect(200)).body.data.items;
    expect(coaches.map((item: { id: string }) => item.id)).toEqual([links[0]]);
    const mine = (await h.e2e.as(coach.token).get('/business/me/gym-links').expect(200)).body.data.items;
    expect(mine.map((item: { status: string }) => item.status)).toEqual(['CONFIRMED', 'CONFIRMED']);
    expect(await noticeKeys(h, coach.id)).toEqual(expect.arrayContaining(links.map((id) => `affiliation:${id}:confirmed`)));
    await h.e2e.as(stranger.token).get(`/me/affiliations/${links[0]}`).expect(404);
    await h.e2e.as(coach.token).post(`/business/me/gym-links/${links[1]}/end`).expect(200);
    expect(await statusOf(h, links[1])).toMatchObject({ status: 'ENDED', reasonCode: 'LEFT' });
  });

  it('a person coaches at several gyms; the gym rejects with a reason chip and the person is told', async () => {
    const coachAtGym = (await requestAt(h, stranger.token, { gymEntityId: gym.entityId, kind: 'ENTRENADOR', ciLast3: '333' }).expect(201)).body.data.id as string;
    const coachAtRival = (await requestAt(h, stranger.token, { gymEntityId: rival.entityId, kind: 'ENTRENADOR', ciLast3: '333' }).expect(201)).body.data.id as string;
    const noNote = await h.e2e.as(gym.token).post(`/business/me/affiliations/${coachAtGym}/reject`).send({ reasonCode: 'OTHER' });
    expect([noNote.status, noNote.body.code]).toEqual([422, 'AFFILIATION_NOTE_REQUIRED']);
    await h.e2e.as(gym.token).post(`/business/me/affiliations/${coachAtGym}/reject`).send({ reasonCode: 'NOT_A_COACH_HERE' }).expect(200);
    await confirm(h, rival, coachAtRival).expect(200);
    expect(await statusOf(h, coachAtGym)).toMatchObject({ status: 'REJECTED', reasonCode: 'NOT_A_COACH_HERE' });
    expect(await noticeKeys(h, stranger.id)).toEqual(expect.arrayContaining([`affiliation:${coachAtGym}:rejected`, `affiliation:${coachAtRival}:confirmed`]));
    const repeat = await requestAt(h, stranger.token, { gymEntityId: gym.entityId, kind: 'ENTRENADOR', ciLast3: '333' });
    expect([repeat.status, repeat.body.code]).toEqual([409, 'AFFILIATION_COOLDOWN']);
    await confirm(h, gym, coachAtGym).expect(409);
  });

  it('a gym REPP suspended keeps its members but no longer reads or decides the pending requests of new people', async () => {
    const newcomer = await h.e2e.register('aff-newcomer');
    const pending = (await requestAt(h, newcomer.token, { gymEntityId: gym.entityId, kind: 'ENTRENADOR', ciLast3: '444' }).expect(201)).body.data.id as string;
    await h.e2e.sql(`UPDATE directory.entities SET status = 'SUSPENDED' WHERE id = :id`, { id: gym.entityId });
    try {
      const inbox = await h.e2e.as(gym.token).get('/business/me/affiliations/requests');
      expect([inbox.status, inbox.body.code]).toEqual([409, 'GYM_NOT_ACTIVE']);
      await h.e2e.as(gym.token).get(`/business/me/affiliations/${pending}`).expect(404);
      const rejected = await h.e2e.as(gym.token).post(`/business/me/affiliations/${pending}/reject`).send({ reasonCode: 'UNKNOWN_PERSON' });
      expect([rejected.status, rejected.body.code]).toEqual([409, 'GYM_NOT_ACTIVE']);
      await h.e2e.as(gym.token).get('/business/me/affiliations/members').expect(200);
    } finally {
      await h.e2e.sql(`UPDATE directory.entities SET status = 'ACTIVE' WHERE id = :id`, { id: gym.entityId });
    }
    await h.e2e.as(gym.token).get(`/business/me/affiliations/${pending}`).expect(200);
  });
});
