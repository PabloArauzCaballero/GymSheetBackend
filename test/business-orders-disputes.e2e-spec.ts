import { QueryTypes } from 'sequelize';
import { businessOrdersMigration } from '../src/database/migrations/202611200801-business-orders';
import { KycHarness, bootKycHarness } from './support/kyc-e2e';
import { registerModerator, resolveCase } from './support/moderation-e2e';
import { Seller, order, removeReceipts, sellerWithQr, uploadReceipt } from './support/orders-e2e';

describe('order disputes to REPP, holder match and the orders migration (e2e, franja 8d)', () => {
  let h: KycHarness;
  let seller: Seller;
  const created: string[] = [];

  beforeAll(async () => {
    h = await bootKycHarness();
    seller = await sellerWithQr(h, 'dsp-seller');
  }, 120000);

  afterAll(async () => {
    // A dispute report would make another suite's migration cycle of 8c fail its re-validated CHECK.
    await h.e2e.sql(`DELETE FROM moderation.reports WHERE target_kind = 'PAYMENT_ORDER' AND target_id IN (:ids)`, { ids: created.length ? created : ['00000000-0000-4000-8000-000000000000'] });
    await removeReceipts(h);
    await h.close();
  });

  const report = (token: string, orderId: string) =>
    h.e2e.as(token).post('/me/reports').send({ targetKind: 'PAYMENT_ORDER', targetId: orderId, reason: 'OTRO', details: 'Pagué y no me confirman.' });

  it('only the buyer disputes its order, once money may have moved; the case reaches the REPP queue with the order', async () => {
    const buyer = await h.e2e.register('dsp-buyer');
    const other = await h.e2e.register('dsp-other');
    const disputed = await order(h, buyer.token, { listingId: seller.listingId });
    created.push(disputed.id);
    await report(buyer.token, disputed.id).expect(404);
    await uploadReceipt(h, buyer.token, disputed.id).expect(200);
    await report(other.token, disputed.id).expect(404);
    const refused = await report(seller.token, disputed.id);
    expect([refused.status, refused.body.code]).toEqual([403, 'ACCOUNT_KIND_NOT_ALLOWED']);
    await report(buyer.token, disputed.id).expect(201);
    await report(buyer.token, disputed.id).expect(409);

    const moderator = await registerModerator(h.e2e, 'dsp-moderator');
    const queue = (await h.e2e.as(moderator.token).get('/admin/moderation/queue?pageSize=50').expect(200)).body.data;
    const card = ((queue.items ?? queue) as { target_id: string }[]).find((item) => item.target_id === disputed.id);
    expect(card).toMatchObject({ target_kind: 'PAYMENT_ORDER', reported_user_id: seller.id, content_hidden: false });
    const dossier = (await h.e2e.as(moderator.token).get(`/admin/moderation/cases/PAYMENT_ORDER/${disputed.id}`).expect(200)).body.data;
    expect(dossier.reportedUser.id).toBe(seller.id);
    expect(dossier.content).toMatchObject({
      kind: 'PAYMENT_ORDER',
      status: 'PENDING_VERIFICATION',
      amount: '250.00',
      currency: 'BOB',
      receipt: { uploaded: true, reference: 'OP-123', path: `/admin/moderation/cases/PAYMENT_ORDER/${disputed.id}/receipt` },
      seller: { entityId: seller.entityId, handle: seller.handle, holderMatch: 'PASS' },
    });
    expect(dossier.content.timeline.map((entry: { status: string }) => entry.status)).toEqual(['PENDING_PAYMENT', 'PENDING_VERIFICATION']);
    expect(JSON.stringify(dossier.content)).not.toMatch(/orders\/|receipt_private_key|\.bin/u);

    const viewed = await h.e2e.as(moderator.token).get(`/admin/moderation/cases/PAYMENT_ORDER/${disputed.id}/receipt`).expect(200);
    expect((viewed.body as Buffer).equals(h.photo)).toBe(true);
    const [audit] = await h.select<{ count: number }>(
      `SELECT count(*)::int AS count FROM admin.audit_log WHERE action = 'payment-order-receipt-view' AND target_id = :id AND actor_user_id = :actor`,
      { id: disputed.id, actor: moderator.id },
    );
    expect(audit.count).toBe(1);
    // REPP sees evidence, never decides the payment (D9).
    await h.e2e.as(moderator.token).post(`/business/me/orders/${disputed.id}/confirm`).expect(403);
  });

  it('a receipt without a case is not served to REPP; the business and persons never reach the evidence route', async () => {
    const buyer = await h.e2e.register('dsp-quiet');
    const quiet = await order(h, buyer.token, { listingId: seller.listingId });
    created.push(quiet.id);
    await uploadReceipt(h, buyer.token, quiet.id).expect(200);
    const moderator = await registerModerator(h.e2e, 'dsp-moderator-2');
    await h.e2e.as(moderator.token).get(`/admin/moderation/cases/PAYMENT_ORDER/${quiet.id}/receipt`).expect(404);
    await h.e2e.as(buyer.token).get(`/admin/moderation/cases/PAYMENT_ORDER/${quiet.id}/receipt`).expect(403);
    await h.e2e.as(seller.token).get(`/admin/moderation/cases/PAYMENT_ORDER/${quiet.id}/receipt`).expect(403);
  });

  it('a dispute can end in suspending the business, never in sanctioning a person; its unpaid orders stop', async () => {
    const shop = await sellerWithQr(h, 'dsp-shop');
    const buyer = await h.e2e.register('dsp-victim');
    const disputed = await order(h, buyer.token, { listingId: shop.listingId });
    created.push(disputed.id);
    await uploadReceipt(h, buyer.token, disputed.id).expect(200);
    await report(buyer.token, disputed.id).expect(201);
    const moderator = await registerModerator(h.e2e, 'dsp-moderator-3');
    const base = `/admin/moderation/cases/PAYMENT_ORDER/${disputed.id}`;
    await h.e2e.as(moderator.token).post(`${base}/claim`).expect(201);
    const ladder = await h.e2e.as(moderator.token).post(`${base}/resolve`).send({ sanction: true });
    expect([ladder.status, ladder.body.code]).toEqual([422, 'MODERATION_RESOLUTION_NOT_APPLICABLE']);
    await h.e2e.as(moderator.token).post(`${base}/release`).expect(201);
    const verdict = await resolveCase(h.e2e, moderator, { kind: 'PAYMENT_ORDER', id: disputed.id }, { suspendBusiness: true });
    expect(verdict.body.data).toMatchObject({ resolution: 'NEGOCIO_SUSPENDIDO', businessSuspended: true });
    const [entity] = await h.select<{ status: string }>('SELECT status FROM directory.entities WHERE id = :id', { id: shop.entityId });
    expect(entity.status).toBe('SUSPENDED');
    // What was paid still waits for the suspended business to decide (plan §2.7).
    await h.e2e.as(shop.token).post(`/business/me/orders/${disputed.id}/reject`).send({ reasonCode: 'NOT_RECEIVED' }).expect(200);
  });

  it('an account holder unlike the KYC legal name or representative is a WARN for REPP, never a block', async () => {
    const shop = await sellerWithQr(h, 'dsp-holder');
    const config = await h.e2e.as(shop.token).put('/business/me/payment-config').send({ bankName: 'Banco Sol', accountHolderName: 'Zzyzx Qwerty Wmbo' }).expect(200);
    expect(config.body.data).toMatchObject({ holderMatch: 'WARN', hasQr: true, bankName: 'Banco Sol' });
    const checks = await h.select<{ outcome: string; detail: { similarity: number } }>(
      `SELECT c.outcome, c.detail FROM business.kyc_checks c JOIN business.accounts a ON a.current_submission_id = c.submission_id
        WHERE a.user_id = :id AND c.code = 'PAYMENT_HOLDER_MATCH'`,
      { id: shop.id },
    );
    expect(checks).toHaveLength(1);
    expect(checks[0].outcome).toBe('WARN');
    expect(Object.keys(checks[0].detail)).toEqual(['similarity']);
    const buyer = await h.e2e.register('dsp-holder-buyer');
    const allowed = await order(h, buyer.token, { listingId: shop.listingId });
    expect(allowed.status).toBe('PENDING_PAYMENT');
    const rival = await sellerWithQr(h, 'dsp-holder-rival');
    expect((await h.e2e.as(rival.token).get('/business/me/payment-config').expect(200)).body.data.bankName).toBe('Banco Unión');
    await h.e2e.as(buyer.token).get('/business/me/payment-config').expect(403);
  });

  it('migration 202611200801 goes down (EXPIRED → CANCELLED, reserved units returned, files queued) and up, in a rolled-back transaction', async () => {
    const buyer = await h.e2e.register('dsp-migration');
    const pending = await order(h, buyer.token, { listingId: seller.listingId });
    created.push(pending.id);
    await uploadReceipt(h, buyer.token, pending.id).expect(200);
    const queryInterface = h.sequelize.getQueryInterface();
    const transaction = await h.sequelize.transaction();
    const one = async <T extends object>(sql: string) =>
      (await h.sequelize.query<T>(sql, { type: QueryTypes.SELECT, replacements: { id: pending.id }, transaction }))[0];
    try {
      // The open reports would not pass the restored CHECK; it comes back NOT VALID, as history.
      await businessOrdersMigration.down(queryInterface, transaction);
      const gone = await one<{ columns: number; history: string | null }>(
        `SELECT (SELECT count(*)::int FROM information_schema.columns WHERE table_schema = 'directory' AND table_name = 'payment_orders' AND column_name = 'quantity') AS columns,
                to_regclass('directory.payment_order_history')::text AS history`,
      );
      expect(gone).toEqual({ columns: 0, history: null });
      const queued = await one<{ count: number }>(
        `SELECT count(*)::int AS count FROM integration.outbox_jobs WHERE queue_name = 'media.release' AND aggregate_type = 'directory.payment_order' AND aggregate_id = :id`,
      );
      expect(queued.count).toBe(1);
      await businessOrdersMigration.up(queryInterface, transaction);
      const back = await one<{ status: string; unitAmount: string }>(`SELECT status, unit_amount AS "unitAmount" FROM directory.payment_orders WHERE id = :id`);
      expect(back).toEqual({ status: 'PENDING_VERIFICATION', unitAmount: '250.00' });
    } finally {
      await transaction.rollback();
    }
    expect((await h.e2e.as(buyer.token).get(`/directory/payments/orders/${pending.id}`).expect(200)).body.data.receipt.uploaded).toBe(true);
  });
});
