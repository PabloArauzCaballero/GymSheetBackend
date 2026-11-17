import { KycBusiness, KycHarness, bootKycHarness } from './support/kyc-e2e';
import { createListing, membership, publicGet, publicIds, publishedBusiness } from './support/listings-e2e';
import { Member, registerModerator, resolveCase } from './support/moderation-e2e';

describe('post-moderation of the marketplace: suspension, reports, hide and REPP console (e2e, franja 8c)', () => {
  let h: KycHarness;
  let moderator: Member;

  beforeAll(async () => {
    h = await bootKycHarness();
    moderator = await registerModerator(h.e2e, 'lst-mod');
  }, 60000);

  afterAll(async () => {
    await h.close();
  });

  const report = (token: string, targetKind: string, targetId: string, reason = 'SPAM') =>
    h.e2e.as(token).post('/me/reports').send({ targetKind, targetId, reason });
  const ownListing = async (owner: KycBusiness, id: string) => (await h.e2e.as(owner.token).get(`/business/me/listings/${id}`).expect(200)).body.data as Record<string, unknown>;

  it('a SUSPENDED business takes every listing off the marketplace (D7) and edits nothing; reinstated, they are back', async () => {
    const seller = await publishedBusiness(h, 'lst-susp');
    const listing = await createListing(h, seller);
    await h.e2e.as(moderator.token).post(`/admin/business/accounts/${seller.id}/suspend`).send({ reasonCode: 'FRAUD_SUSPECTED' }).expect(200);
    await publicGet(h, `/public/directory/listings/${listing.id}`).expect(404);
    await publicGet(h, `/public/directory/plans/${listing.id}`).expect(404);
    await publicGet(h, `/public/directory/profiles/${seller.handle}`).expect(404);
    expect(await publicIds(h, `entity_id=${seller.entityId}`)).toEqual([]);
    expect((await ownListing(seller, listing.id)).visibility).toBe('BUSINESS_NOT_PUBLIC');
    const locked = await h.e2e.as(seller.token).post('/business/me/listings').send(membership());
    expect([locked.status, locked.body.code]).toEqual([409, 'BUSINESS_ACCOUNT_LOCKED']);
    const person = await h.e2e.register('lst-susp-person');
    await report(person.token, 'BUSINESS_LISTING', listing.id).expect(404);
    await h.e2e.as(moderator.token).post(`/admin/business/accounts/${seller.id}/reinstate`).send({ reasonCode: 'OTHER' }).expect(200);
    await publicGet(h, `/public/directory/listings/${listing.id}`).expect(200);
  });

  it('report → REPP queue with the listing snapshot → hide → gone from public; the seller cannot change or republish it; REPP releases it', async () => {
    const seller = await publishedBusiness(h, 'lst-report');
    const listing = await createListing(h, seller);
    const person = await h.e2e.register('lst-reporter-a');
    await report(person.token, 'BUSINESS_LISTING', listing.id).expect(201);
    expect((await report(person.token, 'BUSINESS_LISTING', listing.id)).status).toBe(409);
    const queue = (await h.e2e.as(moderator.token).get('/admin/moderation/queue?pageSize=50').expect(200)).body.data;
    const card = (queue.items ?? queue).find((item: { target_id: string }) => item.target_id === listing.id);
    expect(card).toMatchObject({ target_kind: 'BUSINESS_LISTING', reported_user_id: seller.id, content_hidden: false });
    const dossier = (await h.e2e.as(moderator.token).get(`/admin/moderation/cases/BUSINESS_LISTING/${listing.id}`).expect(200)).body.data;
    expect(dossier.content).toMatchObject({ kind: 'BUSINESS_LISTING', name: expect.stringMatching(/^Plan mensual/u), price: '250.00', seller: { entityId: seller.entityId, handle: seller.handle } });
    const strike = await h.e2e.as(moderator.token).post(`/admin/moderation/cases/BUSINESS_LISTING/${listing.id}/resolve`).send({ sanction: true });
    expect([strike.status, strike.body.code]).toEqual([422, 'MODERATION_RESOLUTION_NOT_APPLICABLE']);

    const verdict = await resolveCase(h.e2e, moderator, { kind: 'BUSINESS_LISTING', id: listing.id }, { hideContent: true });
    expect(verdict.body.data).toMatchObject({ resolution: 'CONTENIDO_OCULTO', contentHidden: true });
    await publicGet(h, `/public/directory/listings/${listing.id}`).expect(404);
    expect(await publicIds(h, `entity_id=${seller.entityId}`)).not.toContain(listing.id);
    expect(await ownListing(seller, listing.id)).toMatchObject({ moderationStatus: 'HIDDEN', visibility: 'HIDDEN_BY_REPP', moderationReasonCode: 'SPAM' });
    expect((await h.e2e.as(seller.token).patch(`/business/me/listings/${listing.id}`).send({ name: 'Plan mensual renovado' })).body.code).toBe('LISTING_LOCKED_BY_REPP');
    expect((await ownListing(seller, listing.id)).moderationStatus).toBe('HIDDEN');

    const hidden = (await h.e2e.as(moderator.token).get('/admin/business/listings?moderationStatus=HIDDEN&limit=50').expect(200)).body.data.items;
    expect(hidden.map((item: { id: string }) => item.id)).toContain(listing.id);
    await h.e2e.as(moderator.token).post(`/admin/business/listings/${listing.id}/release`).send({}).expect(200);
    await publicGet(h, `/public/directory/listings/${listing.id}`).expect(200);
  });

  it('three distinct reporters hide a listing automatically, pending a moderator', async () => {
    const seller = await publishedBusiness(h, 'lst-auto');
    const listing = await createListing(h, seller);
    for (const label of ['lst-auto-a', 'lst-auto-b', 'lst-auto-c']) {
      const person = await h.e2e.register(label);
      await report(person.token, 'BUSINESS_LISTING', listing.id).expect(201);
    }
    await publicGet(h, `/public/directory/listings/${listing.id}`).expect(404);
    expect((await ownListing(seller, listing.id)).moderationStatus).toBe('HIDDEN');
  });

  it('while REPP holds a listing hidden or rejected its content is frozen (409); dismissing restores what REPP reviewed', async () => {
    const seller = await publishedBusiness(h, 'lst-frozen');
    const listing = await createListing(h, seller);
    for (const label of ['lst-frozen-a', 'lst-frozen-b', 'lst-frozen-c']) {
      await report((await h.e2e.register(label)).token, 'BUSINESS_LISTING', listing.id).expect(201);
    }
    expect((await ownListing(seller, listing.id)).moderationStatus).toBe('HIDDEN');
    const as = h.e2e.as(seller.token);
    for (const call of [
      () => as.patch(`/business/me/listings/${listing.id}`).send({ description: 'Contenido nuevo después de la denuncia.' }),
      () => as.patch(`/business/me/listings/${listing.id}/price`).send({ price: 999 }),
      () => as.post(`/business/me/listings/${listing.id}/media`).attach('file', h.logo, { filename: 'p.png', contentType: 'image/png' }),
    ]) {
      const response = await call();
      expect([response.status, response.body.code]).toEqual([409, 'LISTING_LOCKED_BY_REPP']);
    }
    await as.post(`/business/me/listings/${listing.id}/pause`).expect(200);
    await as.post(`/business/me/listings/${listing.id}/resume`).expect(200);
    await resolveCase(h.e2e, moderator, { kind: 'BUSINESS_LISTING', id: listing.id }, { hideContent: false });
    expect(await ownListing(seller, listing.id)).toMatchObject({ moderationStatus: 'LIVE', description: 'Acceso libre a sala y clases.', price: '250.00' });

    await h.e2e.as(moderator.token).post(`/admin/business/listings/${listing.id}/reject`).send({ reasonCode: 'MISLEADING' }).expect(200);
    const rejected = await as.patch(`/business/me/listings/${listing.id}`).send({ name: 'Otro plan' });
    expect([rejected.status, rejected.body.code]).toEqual([409, 'LISTING_LOCKED_BY_REPP']);
  });

  it('a profile report can suspend the business from the verdict: every listing goes, the case closes as NEGOCIO_SUSPENDIDO', async () => {
    const seller = await publishedBusiness(h, 'lst-profile');
    const listing = await createListing(h, seller);
    const person = await h.e2e.register('lst-profile-person');
    await report(person.token, 'BUSINESS_PROFILE', seller.entityId, 'PERFIL_FALSO').expect(201);
    const dossier = (await h.e2e.as(moderator.token).get(`/admin/moderation/cases/BUSINESS_PROFILE/${seller.entityId}`).expect(200)).body.data;
    expect(dossier.content).toMatchObject({ kind: 'BUSINESS_PROFILE', handle: seller.handle, status: 'ACTIVE' });
    const verdict = await resolveCase(h.e2e, moderator, { kind: 'BUSINESS_PROFILE', id: seller.entityId }, { suspendBusiness: true });
    expect(verdict.body.data).toMatchObject({ resolution: 'NEGOCIO_SUSPENDIDO', businessSuspended: true });
    await publicGet(h, `/public/directory/listings/${listing.id}`).expect(404);
    await publicGet(h, `/public/directory/profiles/${seller.handle}`).expect(404);
    const [account] = await h.select<{ status: string; kycStatus: string }>(
      'SELECT status, kyc_status AS "kycStatus" FROM business.accounts WHERE user_id = :id',
      { id: seller.id },
    );
    expect(account).toEqual({ status: 'SUSPENDED', kycStatus: 'SUSPENDED' });
    const audit = await h.select<{ metadata: { businessSuspended: boolean; caseKind: string } }>(
      `SELECT metadata FROM admin.audit_log WHERE domain = 'moderation' AND action = 'resolve' AND target_id = :id`,
      { id: seller.entityId },
    );
    expect(audit[0]?.metadata).toMatchObject({ caseKind: 'BUSINESS_PROFILE', businessSuspended: true });
  });

  it("REPP's listings console: held queue, reject (not public, seller told) and release; only the platform team", async () => {
    const seller = await publishedBusiness(h, 'lst-held');
    const held = await createListing(h, seller, membership({ price: 60_000 }));
    expect(held.autoCheckCodes).toEqual(['PRICE_OUT_OF_BAND']);
    // Oldest first: walk the cursor until the new one appears (the shared database keeps older held listings).
    let found: Record<string, unknown> | undefined;
    let cursor: string | null = null;
    for (let page = 0; page < 100 && !found; page += 1) {
      const query: string = cursor ? `&cursor=${cursor}` : '';
      const data = (await h.e2e.as(moderator.token).get(`/admin/business/listings?limit=50${query}`).expect(200)).body.data as { items: Record<string, unknown>[]; nextCursor: string | null };
      for (const item of data.items) expect(item).not.toHaveProperty('ownerEmail');
      found = data.items.find((item) => item.id === held.id);
      cursor = data.nextCursor;
      if (!cursor) break;
    }
    expect(found).toMatchObject({ moderationStatus: 'HELD', autoCheckCodes: ['PRICE_OUT_OF_BAND'], sellerHandle: seller.handle });
    const person = await h.e2e.register('lst-held-person');
    await h.e2e.as(person.token).get('/admin/business/listings').expect(403);
    await h.e2e.as(seller.token).get('/admin/business/listings').expect(403);
    await h.e2e.as(seller.token).post(`/admin/business/listings/${held.id}/release`).send({}).expect(403);

    await h.e2e.as(moderator.token).post(`/admin/business/listings/${held.id}/reject`).send({ reasonCode: 'PRICE_ABUSE' }).expect(200);
    expect(await ownListing(seller, held.id)).toMatchObject({ moderationStatus: 'REJECTED', visibility: 'REJECTED_BY_REPP', moderationReasonCode: 'PRICE_ABUSE' });
    await publicGet(h, `/public/directory/listings/${held.id}`).expect(404);
    const inbox = (await h.e2e.as(seller.token).get('/notifications/me').expect(200)).body.data.items as { asunto: string | null }[];
    expect(inbox.map((item) => item.asunto)).toContain('REPP no aprobó tu publicación');
    await h.e2e.as(moderator.token).post(`/admin/business/listings/${held.id}/release`).send({}).expect(200);
    await publicGet(h, `/public/directory/listings/${held.id}`).expect(200);
    const audits = await h.select<{ action: string }>(
      `SELECT action FROM admin.audit_log WHERE domain = 'business' AND target_id = :id ORDER BY occurred_at`,
      { id: held.id },
    );
    expect(audits.map((row) => row.action)).toEqual(['listing-reject', 'listing-release']);
  });
});
