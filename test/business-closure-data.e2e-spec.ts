import { QueryTypes } from 'sequelize';
import { env } from '../src/config/env';
import { contractPaymentReceiptUrlMigration } from '../src/database/migrations/202611201202-contract-payment-receipt-url';
import { businessClosureMigration } from '../src/database/migrations/202611201201-business-closure';
import { staffRolesToMembersMigration } from '../src/database/migrations/202611201301-staff-roles-to-members';
import { retireStaffAndAccessControlMigration } from '../src/database/migrations/202611201302-retire-staff-and-access-control';
import { retireTenantAdminChatsMigration } from '../src/database/migrations/202611201303-retire-tenant-admin-chats';
import { KycCipher } from '../src/modules/business-kyc/kyc-cipher';
import { KycRetentionService } from '../src/modules/business-kyc/kyc-retention.service';
import { AccountExportService } from '../src/modules/export/account-export.service';
import { ImageModerationService } from '../src/modules/business-kyc/image-moderation/image-moderation.service';
import { MediaReleaseService } from '../src/modules/media/media-release.service';
import { publishedCoach } from './support/affiliations-e2e';
import { KycBusiness, KycHarness, bootKycHarness } from './support/kyc-e2e';
import { order, removeReceipts, sellerWithQr, uploadReceipt } from './support/orders-e2e';
import { confirmOrder, gymSeller, paidOrder, socioData } from './support/subscriptions-e2e';

const PASSWORD = 'e2e-strong-password';
const DAY_MS = 86_400_000;
const mutableEnv = env as { ORDER_OPEN_MAX_UNVERIFIED_SELLER: number };

describe('business export, KYC retention and erasure, unverified seller cap (e2e, franja 8f, ADR-0028)', () => {
  let h: KycHarness;
  const retention = () => new KycRetentionService(h.sequelize, h.e2e.app.get(MediaReleaseService, { strict: false }));
  const documentsOf = (accountId: string) =>
    h.select<{ kind: string; key: string | null; reason: string | null }>(
      `SELECT d.kind, d.storage_key AS key, d.delete_reason AS reason FROM business.kyc_documents d
         JOIN business.kyc_submissions s ON s.id = d.submission_id WHERE s.account_id = :accountId ORDER BY d.kind`,
      { accountId },
    );

  beforeAll(async () => {
    h = await bootKycHarness();
  }, 60000);

  afterAll(async () => {
    // The closures, the far-future retention passes and every logo uploaded here queue jobs on shared
    // queues: drain them so a later suite's single drain pass finds its own jobs first.
    const release = h.e2e.app.get(MediaReleaseService, { strict: false });
    for (let pass = 0; pass < 20 && (await release.drainOnce(200)) > 0; pass += 1);
    const moderation = h.e2e.app.get(ImageModerationService, { strict: false });
    for (let pass = 0; pass < 20 && (await moderation.drainOnce(200)) > 0; pass += 1);
    await removeReceipts(h);
    await h.close();
  });

  const exportOf = async (owner: KycBusiness) => {
    const requested = await h.e2e.as(owner.token).post('/me/export').expect(202);
    await h.e2e.app.get(AccountExportService).build(requested.body.data.id);
    const download = await h.e2e.as(owner.token).get(`/me/export/${requested.body.data.id}/download`).buffer(true)
      .parse((res, callback) => {
        let text = '';
        res.on('data', (chunk: Buffer) => { text += chunk.toString('utf8'); });
        res.on('end', () => callback(null, text));
      }).expect(200);
    return { text: download.body as string, archive: JSON.parse(download.body as string) };
  };

  it('a company exports its profile, sales and members with display names only, its NIT in clear and never its representative\'s CI', async () => {
    const gym = await gymSeller(h, 'exp-gym');
    const buyer = await h.e2e.register('exp-buyer');
    const paid = await paidOrder(h, buyer.token, { listingId: gym.listingId, affiliation: socioData(gym, { ciLast3: '987' }) });
    await confirmOrder(h, gym, paid.id).expect(200);
    const [stored] = await h.select<{ nit: Buffer; ci: Buffer; repCi: string }>(
      `SELECT nit_enc AS nit, rep_ci_enc AS ci, rep_ci_masked AS "repCi" FROM business.kyc_submissions WHERE account_id = :id`, { id: gym.id });
    const cipher = new KycCipher();

    const { text, archive } = await exportOf(gym);
    for (const key of ['business.profile', 'business.locations', 'business.listings', 'business.price_history', 'business.orders', 'business.affiliations', 'business.subscriptions', 'business.payment_config']) {
      expect([key, archive.tables[key]?.rows.length > 0]).toEqual([key, true]);
    }
    const [sale] = archive.tables['business.orders'].rows;
    expect(sale).toMatchObject({ id: paid.id, buyer_display_name: expect.any(String) });
    expect(sale).not.toHaveProperty('athlete_user_id');
    const [affiliation] = archive.tables['business.affiliations'].rows;
    expect(affiliation).toMatchObject({ subject_display_name: expect.any(String) });
    expect(affiliation).not.toHaveProperty('ci_last3');
    expect(text).not.toContain(buyer.id);
    expect(archive.businessKyc.submissions[0]).toMatchObject({ nit: cipher.decryptText(stored.nit), repCiNumber: stored.repCi });
    expect(text).not.toContain(cipher.decryptText(stored.ci));
    expect(archive.businessKyc.documents.map((doc: { withheld: string | null }) => doc.withheld)).toEqual(['REPRESENTATIVE_IDENTITY', 'REPRESENTATIVE_IDENTITY', 'REPRESENTATIVE_IDENTITY']);
  }, 120000);

  it('a coach (the owner is the person) gets its own CI and its documents decrypted in the package', async () => {
    const coach = await publishedCoach(h, 'exp-coach');
    const { archive } = await exportOf(coach);
    expect(archive.businessKyc.submissions[0].repCiNumber).toMatch(/^\d{7}$/u);
    const documents = archive.businessKyc.documents as { kind: string; contentBase64: string | null }[];
    expect(documents.map((doc) => doc.kind).sort()).toEqual(['CI_BACK', 'CI_FRONT', 'SELFIE']);
    for (const doc of documents) expect(Buffer.from(doc.contentBase64 ?? '', 'base64').equals(h.photo)).toBe(true);
  }, 60000);

  it('retention by the clock: the selfie goes 30 days after approval while the CI stays; 180 days after closure the CI and clear data go; at 5 years the records', async () => {
    const owner = await h.ready('ret-close');
    await h.e2e.as(owner.token).post('/business/me/kyc/submit').expect(200);
    const now = Date.now();
    await retention().purge(new Date(now + 31 * DAY_MS));
    expect((await documentsOf(owner.id)).map((doc) => [doc.kind, doc.key === null])).toEqual([['CI_BACK', false], ['CI_FRONT', false], ['SELFIE', true]]);

    await h.e2e.as(owner.token).del('/me/account').send({ password: PASSWORD }).expect(200);
    await retention().purge(new Date(now + 179 * DAY_MS));
    expect((await documentsOf(owner.id)).filter((doc) => doc.key !== null)).toHaveLength(2);
    await retention().purge(new Date(now + 181 * DAY_MS));
    expect((await documentsOf(owner.id)).map((doc) => doc.reason)).toEqual(['CLOSURE', 'CLOSURE', 'RETENTION']);
    const [identity] = await h.select<{ name: string | null; ci: Buffer | null; hmac: string | null }>(
      'SELECT rep_full_name AS name, rep_ci_enc AS ci, rep_ci_hmac AS hmac FROM business.kyc_submissions WHERE account_id = :id', { id: owner.id });
    expect([identity.name, identity.ci, identity.hmac?.length]).toEqual([null, null, 64]);

    const records = (table: string, column = 'account_id') => h.select(`SELECT 1 FROM ${table} WHERE ${column} = :id`, { id: owner.id });
    await retention().purge(new Date(now + 1824 * DAY_MS));
    expect(await records('business.identity_fingerprints')).not.toHaveLength(0);
    const result = await retention().purge(new Date(now + 1826 * DAY_MS));
    expect(result.recordsPurgedAccounts).toBeGreaterThanOrEqual(1);
    for (const table of ['business.identity_fingerprints', 'business.kyc_submissions', 'business.kyc_status_history']) expect([table, await records(table)]).toEqual([table, []]);
    expect(await records('business.accounts', 'user_id')).toHaveLength(1);
  }, 60000);

  it('erasing the own KYC on request is allowed and leaves the account SUSPENDED with KYC_MISSING; REPP cannot reinstate it as is', async () => {
    const owner = await h.ready('erase-kyc');
    await h.e2e.as(owner.token).post('/business/me/kyc/submit').expect(200);
    await h.e2e.as(owner.token).post('/business/me/kyc/erase').send({ password: 'wrong-password' }).expect(400);
    const erased = await h.e2e.as(owner.token).post('/business/me/kyc/erase').send({ password: PASSWORD }).expect(200);
    expect(erased.body.data).toEqual({ status: 'SUSPENDED', suspensionReasonCode: 'KYC_MISSING', kycStatus: 'SUSPENDED', documentsErased: 3 });
    expect((await documentsOf(owner.id)).every((doc) => doc.key === null && doc.reason === 'USER_REQUEST')).toBe(true);
    expect(await h.select('SELECT e.status FROM directory.entities e WHERE e.id = :id', { id: owner.entityId })).toEqual([{ status: 'SUSPENDED' }]);
    const [jobs] = await h.select<{ count: number }>(
      `SELECT count(*)::int AS count FROM integration.outbox_jobs WHERE queue_name = 'media.release' AND payload->>'storageKey' LIKE :prefix`,
      { prefix: `business/${owner.id}/kyc/%` },
    );
    expect(jobs.count).toBe(3);
    const moderator = await h.e2e.register('erase-moderator');
    await h.e2e.promote(moderator.id, 'MODERATOR');
    const reinstate = await h.e2e.as(moderator.token).post(`/admin/business/accounts/${owner.id}/reinstate`).send({ reasonCode: 'OTHER' });
    expect([reinstate.status, reinstate.body.code]).toEqual([409, 'KYC_INVALID_TRANSITION']);
    const person = await h.e2e.register('erase-person');
    await h.e2e.as(person.token).post('/business/me/kyc/erase').send({ password: PASSWORD }).expect(403);
  }, 60000);

  it('a business not yet verified by REPP holds at most N open orders: 409 ORDER_SELLER_OPEN_LIMIT, freed by a cancellation, no cap once verified', async () => {
    const before = mutableEnv.ORDER_OPEN_MAX_UNVERIFIED_SELLER;
    mutableEnv.ORDER_OPEN_MAX_UNVERIFIED_SELLER = 2;
    try {
      const seller = await sellerWithQr(h, 'cap-seller');
      const buyers = [await h.e2e.register('cap-a'), await h.e2e.register('cap-b'), await h.e2e.register('cap-c')];
      const first = await order(h, buyers[0].token, { listingId: seller.listingId });
      await order(h, buyers[1].token, { listingId: seller.listingId });
      const refused = await h.e2e.as(buyers[2].token).post('/directory/payments/orders').send({ listingId: seller.listingId });
      expect([refused.status, refused.body.code]).toEqual([409, 'ORDER_SELLER_OPEN_LIMIT']);
      expect(refused.body.detail).toContain('nuevo en REPP');
      await h.e2e.as(buyers[0].token).post(`/directory/payments/orders/${first.id}/cancel`).expect(200);
      await order(h, buyers[2].token, { listingId: seller.listingId });
      await h.e2e.sql('UPDATE directory.entities SET is_verified = true WHERE id = :id', { id: seller.entityId });
      await order(h, buyers[0].token, { listingId: seller.listingId });
    } finally {
      mutableEnv.ORDER_OPEN_MAX_UNVERIFIED_SELLER = before;
    }
  }, 60000);

  it('a buyer cannot send a receipt to a business that stopped being public (409 ORDER_BUSINESS_UNAVAILABLE)', async () => {
    const seller = await sellerWithQr(h, 'gone-seller');
    const buyer = await h.e2e.register('gone-buyer');
    const created = await order(h, buyer.token, { listingId: seller.listingId });
    await h.e2e.sql(`UPDATE directory.entities SET status = 'SUSPENDED' WHERE id = :id`, { id: seller.entityId });
    const refused = await uploadReceipt(h, buyer.token, created.id);
    expect([refused.status, refused.body.code]).toEqual([409, 'ORDER_BUSINESS_UNAVAILABLE']);
    expect(await h.select('SELECT status FROM directory.payment_orders WHERE id = :id', { id: created.id })).toEqual([{ status: 'PENDING_PAYMENT' }]);
  }, 60000);

  it('payment_orders.receipt_url is gone; the migrations go down (legacy values back) and up again', async () => {
    const seller = await sellerWithQr(h, 'mig-seller');
    const buyer = await h.e2e.register('mig-buyer');
    const created = await order(h, buyer.token, { listingId: seller.listingId });
    const queryInterface = h.sequelize.getQueryInterface();
    const transaction = await h.sequelize.transaction();
    const column = async () =>
      (await h.sequelize.query<{ name: string }>(
        `SELECT column_name::text AS name FROM information_schema.columns WHERE table_schema = 'directory' AND table_name = 'payment_orders' AND column_name = 'receipt_url'`,
        { type: QueryTypes.SELECT, transaction },
      )).length;
    try {
      expect(await column()).toBe(0);
      await h.sequelize.query(`INSERT INTO retired.payment_order_receipt_urls (order_id, receipt_url) VALUES (:id, 'https://legacy.example/r.jpg')`, { replacements: { id: created.id }, transaction });
      // Reverse id order: the staff contraction of 7d (202611201301–1303) is newer than this franja.
      await retireTenantAdminChatsMigration.down(queryInterface, transaction);
      await retireStaffAndAccessControlMigration.down(queryInterface, transaction);
      await staffRolesToMembersMigration.down(queryInterface, transaction);
      await contractPaymentReceiptUrlMigration.down(queryInterface, transaction);
      await businessClosureMigration.down(queryInterface, transaction);
      const [restored] = await h.sequelize.query<{ url: string }>('SELECT receipt_url AS url FROM directory.payment_orders WHERE id = :id', { type: QueryTypes.SELECT, replacements: { id: created.id }, transaction });
      expect(restored.url).toBe('https://legacy.example/r.jpg');
      await businessClosureMigration.up(queryInterface, transaction);
      await contractPaymentReceiptUrlMigration.up(queryInterface, transaction);
      await staffRolesToMembersMigration.up(queryInterface, transaction);
      await retireStaffAndAccessControlMigration.up(queryInterface, transaction);
      await retireTenantAdminChatsMigration.up(queryInterface, transaction);
      expect(await column()).toBe(0);
      const [kept] = await h.sequelize.query<{ url: string }>('SELECT receipt_url AS url FROM retired.payment_order_receipt_urls WHERE order_id = :id', { type: QueryTypes.SELECT, replacements: { id: created.id }, transaction });
      expect(kept.url).toBe('https://legacy.example/r.jpg');
    } finally {
      await transaction.rollback();
    }
  }, 60000);
});
