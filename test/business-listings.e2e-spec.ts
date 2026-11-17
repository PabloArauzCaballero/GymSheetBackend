import { QueryTypes } from 'sequelize';
import request from 'supertest';
import { businessListingsMigration } from '../src/database/migrations/202611200601-business-listings';
import { listingVersionStampMigration } from '../src/database/migrations/202611200602-listing-version-stamp';
import { businessConversationsMigration } from '../src/database/migrations/202611200701-business-conversations';
import { businessOrdersMigration } from '../src/database/migrations/202611200801-business-orders';
import { affiliationsMigration } from '../src/database/migrations/202611200901-affiliations';
import { affiliationsClosedRowsMigration } from '../src/database/migrations/202611200901-affiliations-closed-rows';
import { subscriptionLedgerMigration } from '../src/database/migrations/202611201001-subscription-ledger';
import { retireMembershipMachineryMigration } from '../src/database/migrations/202611201002-retire-membership-machinery';
import { gymMembershipVisibilityMigration } from '../src/database/migrations/202611201101-gym-membership-visibility';
import { businessClosureMigration } from '../src/database/migrations/202611201201-business-closure';
import { contractPaymentReceiptUrlMigration } from '../src/database/migrations/202611201202-contract-payment-receipt-url';
import { KycBusiness, KycHarness, bootKycHarness, letters } from './support/kyc-e2e';
import { createListing, membership, publicGet, publicIds, publishedBusiness } from './support/listings-e2e';

describe('business listings, locations and the public marketplace (e2e, franja 8c)', () => {
  let h: KycHarness;
  let seller: KycBusiness;
  let rival: KycBusiness;

  beforeAll(async () => {
    h = await bootKycHarness();
    seller = await publishedBusiness(h, 'lst-seller');
    rival = await publishedBusiness(h, 'lst-rival');
  }, 90000);

  afterAll(async () => {
    await h.close();
  });

  it('401 without a token; a person gets 403 ACCOUNT_KIND_NOT_ALLOWED on business/me/listings and locations', async () => {
    await request(h.e2e.http).get(h.e2e.url('/business/me/listings')).expect(401);
    const person = await h.e2e.register('lst-person');
    for (const [method, path] of [
      ['get', '/business/me/listings'],
      ['post', '/business/me/listings'],
      ['get', '/business/me/locations'],
      ['post', '/business/me/locations'],
    ] as const) {
      const response = await h.e2e.as(person.token)[method](path).send(membership());
      expect({ path, status: response.status, code: response.body.code }).toEqual({ path, status: 403, code: 'ACCOUNT_KIND_NOT_ALLOWED' });
    }
  });

  it('a listing that passes the checks is LIVE and public at once, priced in BOB, mapped without private fields', async () => {
    const listing = await createListing(h, seller);
    expect(listing).toMatchObject({ moderationStatus: 'LIVE', visibility: 'PUBLIC', autoCheckCodes: [] });
    const detail = (await publicGet(h, `/public/directory/listings/${listing.id}`).expect(200)).body.data;
    expect(detail).toMatchObject({ id: listing.id, offerKind: 'MEMBERSHIP', price: '250.00', currency: 'BOB', validityDays: 30 });
    expect(detail.seller).toMatchObject({ id: seller.entityId, handle: seller.handle, badge: 'NEW' });
    for (const field of ['moderationStatus', 'autoCheckCodes', 'stockReserved', 'metadata', 'status']) expect(detail).not.toHaveProperty(field);
    expect(await publicIds(h, `entity_id=${seller.entityId}`)).toContain(listing.id);
    expect(await publicIds(h, `q=@${seller.handle}`)).toContain(listing.id);
  });

  it("another business's listing is 404 on every route; each business lists only its own", async () => {
    const listing = await createListing(h, seller);
    const as = h.e2e.as(rival.token);
    for (const call of [
      () => as.get(`/business/me/listings/${listing.id}`),
      () => as.patch(`/business/me/listings/${listing.id}`).send({ name: 'Robado' }),
      () => as.patch(`/business/me/listings/${listing.id}/price`).send({ price: 1 }),
      () => as.post(`/business/me/listings/${listing.id}/pause`),
      () => as.post(`/business/me/listings/${listing.id}/archive`),
      () => as.del(`/business/me/listings/${listing.id}/media/0`),
      () => as.post(`/business/me/listings/${listing.id}/media`).attach('file', h.logo, { filename: 'a.png', contentType: 'image/png' }),
    ]) {
      expect((await call()).status).toBe(404);
    }
    const own = (await h.e2e.as(rival.token).get('/business/me/listings').expect(200)).body.data.items as { id: string }[];
    expect(own.map((item) => item.id)).not.toContain(listing.id);
    expect((await h.e2e.as(seller.token).get(`/business/me/listings/${listing.id}`).expect(200)).body.data.name).toMatch(/^Plan mensual/u);
  });

  it('required fields per kind are a 422; the seller never writes moderation, currency or reserved stock (400)', async () => {
    const shape = await h.e2e.as(seller.token).post('/business/me/listings').send(membership({ validityDays: null }));
    expect([shape.status, shape.body.code, shape.body.details?.violations]).toEqual([422, 'LISTING_SHAPE_INVALID', ['VALIDITY_REQUIRED']]);
    const pack = await h.e2e.as(seller.token).post('/business/me/listings').send(membership({ offerKind: 'CLASS_PACK', validityDays: null }));
    expect(pack.body.details?.violations).toEqual(['SESSIONS_REQUIRED']);
    for (const extra of [{ moderationStatus: 'LIVE' }, { currency: 'USD' }, { stockReserved: 0 }, { type: 'PRODUCT' }, { entityId: rival.entityId }]) {
      await h.e2e.as(seller.token).post('/business/me/listings').send(membership(extra)).expect(400);
    }
    const product = await createListing(h, seller, { offerKind: 'PRODUCT', name: `Guantes ${letters(5)}`, description: 'Guantes de entrenamiento.', price: 120, stockQuantity: 4 });
    const stock = await h.e2e.as(seller.token).patch(`/business/me/listings/${product.id}/stock`).send({ stockQuantity: 9 }).expect(200);
    expect(stock.body.data.stockQuantity).toBe(9);
  });

  it('the database refuses a LIVE listing without the shape of its kind or not in BOB', async () => {
    const listing = await createListing(h, seller);
    await expect(h.e2e.sql('UPDATE directory.entity_plans SET duration_days = NULL WHERE id = :id', { id: listing.id })).rejects.toThrow(/ck_entity_plan_live_validity/u);
    await expect(h.e2e.sql("UPDATE directory.entity_plans SET currency = 'USD' WHERE id = :id", { id: listing.id })).rejects.toThrow(/ck_entity_plan_live_currency/u);
    await expect(h.e2e.sql("UPDATE directory.entity_plans SET type = 'PRODUCT' WHERE id = :id", { id: listing.id })).rejects.toThrow(/ck_entity_plan_type_of_kind/u);
  });

  it('out of the price band or with a banned term it is HELD: not public, not reportable; fixing it publishes it', async () => {
    const held = await createListing(h, seller, membership({ price: 0 }));
    expect(held).toMatchObject({ moderationStatus: 'HELD', visibility: 'UNDER_REVIEW', autoCheckCodes: ['PRICE_OUT_OF_BAND'] });
    await publicGet(h, `/public/directory/listings/${held.id}`).expect(404);
    expect(await publicIds(h, `entity_id=${seller.entityId}&limit=50`)).not.toContain(held.id);
    await publicGet(h, `/public/directory/plans/${held.id}`).expect(404);
    const reporter = await h.e2e.register('lst-reporter');
    await h.e2e.as(reporter.token).post('/me/reports').send({ targetKind: 'BUSINESS_LISTING', targetId: held.id, reason: 'SPAM' }).expect(404);
    await h.e2e.as(reporter.token).post('/directory/payments/orders').send({ listingId: held.id }).expect(404);
    const fixed = await h.e2e.as(seller.token).patch(`/business/me/listings/${held.id}/price`).send({ price: 240 }).expect(200);
    expect(fixed.body.data).toMatchObject({ moderationStatus: 'LIVE', autoCheckCodes: [] });
    await publicGet(h, `/public/directory/listings/${held.id}`).expect(200);

    const moderator = await h.e2e.register('lst-terms-mod');
    await h.e2e.promote(moderator.id, 'MODERATOR');
    const previous = (await h.e2e.as(moderator.token).get('/admin/business/banned-terms').expect(200)).body.data.terms;
    const term = `prohibido${letters(5)}`;
    try {
      await h.e2e.as(moderator.token).put('/admin/business/banned-terms').send({ terms: [...previous, { term, scope: 'LISTING' }] }).expect(200);
      const banned = await createListing(h, seller, membership({ description: `Incluye ${term} de regalo.` }));
      expect(banned).toMatchObject({ moderationStatus: 'HELD', autoCheckCodes: ['BANNED_TERMS'] });
      const edited = await h.e2e.as(seller.token).patch(`/business/me/listings/${banned.id}`).send({ description: 'Incluye toalla de regalo.' }).expect(200);
      expect(edited.body.data.moderationStatus).toBe('LIVE');
    } finally {
      await h.e2e.as(moderator.token).put('/admin/business/banned-terms').send({ terms: previous });
    }
  });

  it('a paused or archived listing leaves the marketplace; an archived one is not edited (409)', async () => {
    const listing = await createListing(h, seller);
    await h.e2e.as(seller.token).post(`/business/me/listings/${listing.id}/pause`).expect(200);
    await publicGet(h, `/public/directory/listings/${listing.id}`).expect(404);
    expect((await h.e2e.as(seller.token).post(`/business/me/listings/${listing.id}/pause`)).body.code).toBe('LISTING_INVALID_TRANSITION');
    await h.e2e.as(seller.token).post(`/business/me/listings/${listing.id}/resume`).expect(200);
    await publicGet(h, `/public/directory/listings/${listing.id}`).expect(200);
    await h.e2e.as(seller.token).post(`/business/me/listings/${listing.id}/archive`).expect(200);
    const edit = await h.e2e.as(seller.token).patch(`/business/me/listings/${listing.id}`).send({ name: 'Otro nombre' });
    expect([edit.status, edit.body.code]).toEqual([409, 'LISTING_NOT_EDITABLE']);
  });

  it('a business still in KYC prepares listings that are not public until it is approved; at most 500 open', async () => {
    const draft = await h.business('lst-draft');
    const listing = await createListing(h, draft);
    expect(listing).toMatchObject({ moderationStatus: 'LIVE', visibility: 'BUSINESS_NOT_PUBLIC' });
    await publicGet(h, `/public/directory/listings/${listing.id}`).expect(404);
    expect(await publicIds(h, `entity_id=${draft.entityId}`)).toEqual([]);
    await h.e2e.sql(
      `INSERT INTO directory.entity_plans (entity_id, offer_kind, type, name, slug, description, current_price, currency, moderation_status)
       SELECT :entityId, 'SERVICE_SESSION', 'SERVICE', 'Relleno', 'relleno-' || n, 'Relleno de prueba', 10, 'BOB', 'HELD'
         FROM generate_series(1, 499) AS n`,
      { entityId: draft.entityId },
    );
    const capped = await h.e2e.as(draft.token).post('/business/me/listings').send(membership());
    expect([capped.status, capped.body.code]).toEqual([409, 'LISTING_LIMIT']);
    // The 499 rows share one microsecond timestamp: the cursor must still walk them once each.
    const seen = new Set<string>();
    let cursor: string | null = null;
    for (let page = 0; page < 20; page += 1) {
      const query: string = cursor ? `&cursor=${cursor}` : '';
      const data = (await h.e2e.as(draft.token).get(`/business/me/listings?limit=50${query}`).expect(200)).body.data as { items: { id: string }[]; nextCursor: string | null };
      for (const item of data.items) seen.add(item.id);
      cursor = data.nextCursor;
      if (!cursor) break;
    }
    expect([seen.size, cursor]).toEqual([500, null]);
    await h.e2e.sql(`DELETE FROM directory.entity_plans WHERE entity_id = :entityId AND name = 'Relleno'`, { entityId: draft.entityId });
  });

  it('search pages by keyset cursor without overlap; filters bind values; a tampered cursor is 400', async () => {
    const shop = await publishedBusiness(h, 'lst-pages');
    const ids = [] as string[];
    for (const price of [100, 200, 300]) ids.push((await createListing(h, shop, membership({ price }))).id);
    const first = (await publicGet(h, `/public/directory/listings?entity_id=${shop.entityId}&limit=2`).expect(200)).body.data;
    expect(first.items).toHaveLength(2);
    const second = (await publicGet(h, `/public/directory/listings?entity_id=${shop.entityId}&limit=2&cursor=${first.nextCursor}`).expect(200)).body.data;
    expect(second.nextCursor).toBeNull();
    expect([...first.items, ...second.items].map((item: { id: string }) => item.id).sort()).toEqual([...ids].sort());
    const cheap = await publicIds(h, `entity_id=${shop.entityId}&sort=price_asc&price_max=250`);
    expect(cheap).toEqual([ids[0], ids[1]]);
    const page = (await publicGet(h, `/public/directory/listings?entity_id=${shop.entityId}&sort=price_desc&limit=1`).expect(200)).body.data;
    expect(page.items[0].id).toBe(ids[2]);
    const next = (await publicGet(h, `/public/directory/listings?entity_id=${shop.entityId}&sort=price_desc&limit=1&cursor=${page.nextCursor}`).expect(200)).body.data;
    expect(next.items[0].id).toBe(ids[1]);
    expect((await publicGet(h, '/public/directory/listings?cursor=bm90LWEtY3Vyc29y').expect(400)).body.code).toBe('INVALID_CURSOR');
    await publicGet(h, `/public/directory/listings?q=${encodeURIComponent("%' OR 1=1 --")}`).expect(200);
    expect(await publicIds(h, `entity_id=${shop.entityId}&q=${encodeURIComponent('%')}`)).toHaveLength(3);
    await publicGet(h, `/public/directory/listings?category_path=${encodeURIComponent('gimnasios%')}`).expect(400);
    await publicGet(h, '/public/directory/listings?unknown=1').expect(400);
  });

  it('locations: CRUD of its own, 404 on a foreign one, public with the profile by @handle', async () => {
    const created = await h.e2e.as(seller.token).post('/business/me/locations').send({ name: 'Sede Centro', city: 'La Paz', latitude: -16.5, longitude: -68.15 }).expect(201);
    const id = created.body.data.id as string;
    expect((await h.e2e.as(seller.token).post('/business/me/locations').send({ name: 'sede centro', city: 'La Paz' })).body.code).toBe('LOCATION_NAME_TAKEN');
    await h.e2e.as(seller.token).post('/business/me/locations').send({ name: 'Sin pareja', city: 'La Paz', latitude: -16.5 }).expect(400);
    await h.e2e.as(rival.token).patch(`/business/me/locations/${id}`).send({ name: 'Mía' }).expect(404);
    await h.e2e.as(rival.token).del(`/business/me/locations/${id}`).expect(404);
    await h.e2e.as(seller.token).patch(`/business/me/locations/${id}`).send({ address: 'Av. 6 de Agosto 100' }).expect(200);
    const profile = (await publicGet(h, `/public/directory/profiles/${seller.handle}`).expect(200)).body.data;
    expect(profile.handle).toBe(seller.handle);
    expect(profile.locations).toEqual([expect.objectContaining({ id, name: 'Sede Centro', address: 'Av. 6 de Agosto 100', latitude: -16.5 })]);
    expect(profile.listings.items.length).toBeGreaterThan(0);
    for (const item of profile.listings.items) expect(item.seller.id).toBe(seller.entityId);
    await h.e2e.as(seller.token).del(`/business/me/locations/${id}`).expect(204);
    await publicGet(h, `/public/directory/profiles/${letters(12)}`).expect(404);
  });

  it('photos are uploaded files (JPEG/PNG by bytes), at most ten, removed by position', async () => {
    const listing = await createListing(h, seller);
    const added = await h.e2e.as(seller.token).post(`/business/me/listings/${listing.id}/media`).attach('file', h.logo, { filename: 'p.png', contentType: 'image/png' }).expect(201);
    expect(added.body.data.mediaUrls).toHaveLength(1);
    await h.e2e.as(seller.token).post(`/business/me/listings/${listing.id}/media`).attach('file', Buffer.from('not an image'), { filename: 'x.png', contentType: 'image/png' }).expect(400);
    const removed = await h.e2e.as(seller.token).del(`/business/me/listings/${listing.id}/media/0`).expect(200);
    expect(removed.body.data.mediaUrls).toEqual([]);
    const gallery = await h.e2e.as(seller.token).post('/business/me/gallery').attach('file', h.logo, { filename: 'g.png', contentType: 'image/png' }).expect(201);
    expect(gallery.body.data.gallery).toHaveLength(1);
    expect((await h.e2e.as(seller.token).del('/business/me/gallery/0').expect(200)).body.data.gallery).toEqual([]);
  });

  it('migrations 202611200602 and 202611200601 go down (what is not LIVE stops being sold) and up again, inside a rolled-back transaction', async () => {
    const live = await createListing(h, seller);
    const held = await createListing(h, seller, membership({ price: 0 }));
    const queryInterface = h.sequelize.getQueryInterface();
    const transaction = await h.sequelize.transaction();
    const statusOf = async (id: string) =>
      (await h.sequelize.query<{ status: string }>('SELECT status FROM directory.entity_plans WHERE id = :id', { type: QueryTypes.SELECT, replacements: { id }, transaction }))[0]?.status;
    try {
      // Reverse id order: 202611201101, 202611201002, 202611201001, the affiliations (202611200901, which
      // reference the locations), the orders (202611200801) and the business chats (202611200701) go first.
      // The business closure (202611201202, 202611201201) rolls back first: it is the newest.
      await contractPaymentReceiptUrlMigration.down(queryInterface, transaction);
      await businessClosureMigration.down(queryInterface, transaction);
      await gymMembershipVisibilityMigration.down(queryInterface, transaction);
      await retireMembershipMachineryMigration.down(queryInterface, transaction);
      await subscriptionLedgerMigration.down(queryInterface, transaction);
      await affiliationsClosedRowsMigration.down(queryInterface, transaction);
      await affiliationsMigration.down(queryInterface, transaction);
      await businessOrdersMigration.down(queryInterface, transaction);
      await businessConversationsMigration.down(queryInterface, transaction);
      await listingVersionStampMigration.down(queryInterface, transaction);
      await businessListingsMigration.down(queryInterface, transaction);
      expect([await statusOf(live.id), await statusOf(held.id)]).toEqual(['ACTIVE', 'INACTIVE']);
      const [gone] = await h.sequelize.query<{ locations: string | null; column: number }>(
        `SELECT to_regclass('directory.entity_locations')::text AS locations,
                (SELECT count(*)::int FROM information_schema.columns WHERE table_schema = 'directory' AND table_name = 'entity_plans' AND column_name = 'offer_kind') AS column`,
        { type: QueryTypes.SELECT, transaction },
      );
      expect(gone).toEqual({ locations: null, column: 0 });
      await businessListingsMigration.up(queryInterface, transaction);
      await listingVersionStampMigration.up(queryInterface, transaction);
      await businessConversationsMigration.up(queryInterface, transaction);
      await businessOrdersMigration.up(queryInterface, transaction);
      await affiliationsMigration.up(queryInterface, transaction);
      await affiliationsClosedRowsMigration.up(queryInterface, transaction);
      await subscriptionLedgerMigration.up(queryInterface, transaction);
      await retireMembershipMachineryMigration.up(queryInterface, transaction);
      await gymMembershipVisibilityMigration.up(queryInterface, transaction);
      await businessClosureMigration.up(queryInterface, transaction);
      await contractPaymentReceiptUrlMigration.up(queryInterface, transaction);
      const [back] = await h.sequelize.query<{ offerKind: string; moderationStatus: string }>(
        'SELECT offer_kind AS "offerKind", moderation_status AS "moderationStatus" FROM directory.entity_plans WHERE id = :id',
        { type: QueryTypes.SELECT, replacements: { id: live.id }, transaction },
      );
      expect(back).toEqual({ offerKind: 'MEMBERSHIP', moderationStatus: 'LIVE' });
    } finally {
      await transaction.rollback();
    }
    await publicGet(h, `/public/directory/listings/${live.id}`).expect(200);
  });
});
