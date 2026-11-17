import express from 'express';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import request from 'supertest';
import { env } from '../src/config/env';
import { OrderMaintenanceService } from '../src/modules/business-orders/order-maintenance.service';
import { mountLocalMedia } from '../src/modules/media/local-media-mount';
import { KycHarness, bootKycHarness } from './support/kyc-e2e';
import { Seller, order, productOf, removeReceipts, sellerWithQr, stockOf, uploadReceipt } from './support/orders-e2e';

describe('marketplace orders paid by QR or cash, confirmed by the business (e2e, franja 8d)', () => {
  let h: KycHarness;
  let seller: Seller;
  let rival: Seller;
  let buyer: { token: string; id: string };
  let stranger: { token: string; id: string };

  beforeAll(async () => {
    h = await bootKycHarness();
    seller = await sellerWithQr(h, 'ord-seller', { acceptsCash: true });
    rival = await sellerWithQr(h, 'ord-rival');
    buyer = await h.e2e.register('ord-buyer');
    stranger = await h.e2e.register('ord-stranger');
  }, 120000);

  afterAll(async () => {
    await removeReceipts(h);
    await h.close();
  });

  // eslint-disable-next-line @typescript-eslint/no-unsafe-return -- supertest types the body as `any`.
  const statusOf = async (orderId: string) => (await h.e2e.as(buyer.token).get(`/directory/payments/orders/${orderId}`).expect(200)).body.data;
  const maintenance = () => h.e2e.app.get(OrderMaintenanceService).runOnce(500);

  it('the price comes from the listing, never from the body; only products take several units', async () => {
    for (const extra of [{ amount: 1 }, { unitAmount: '1.00' }, { currency: 'USD' }, { planId: seller.listingId }]) {
      await h.e2e.as(buyer.token).post('/directory/payments/orders').send({ listingId: seller.listingId, ...extra }).expect(400);
    }
    const quantity = await h.e2e.as(buyer.token).post('/directory/payments/orders').send({ listingId: seller.listingId, quantity: 2 });
    expect([quantity.status, quantity.body.code]).toEqual([422, 'ORDER_QUANTITY_NOT_ALLOWED']);
    const created = await order(h, buyer.token, { listingId: seller.listingId });
    expect(created).toMatchObject({ status: 'PENDING_PAYMENT', unitAmount: '250.00', amount: '250.00', quantity: 1 });
    const again = await h.e2e.as(buyer.token).post('/directory/payments/orders').send({ listingId: seller.listingId });
    expect([again.status, again.body.code, again.body.details?.orderId]).toEqual([409, 'ORDER_ALREADY_OPEN', created.id]);
    await h.e2e.as(buyer.token).post(`/directory/payments/orders/${created.id}/cancel`).expect(200);
  });

  it('payment data is not public; the instructions and the QR go only to the buyer of the order', async () => {
    await request(h.e2e.http).get(h.e2e.url(`/public/directory/entities/${seller.entityId}/payment-config`)).expect(404);
    const created = await order(h, buyer.token, { listingId: seller.listingId });
    const instructions = (await h.e2e.as(buyer.token).get(`/directory/payments/orders/${created.id}/payment-instructions`).expect(200)).body.data;
    expect(instructions).toMatchObject({ method: 'QR', bankName: 'Banco Unión', accountHolderName: 'Representante Prueba', amount: '250.00', currency: 'BOB' });
    expect(instructions).not.toHaveProperty('taxId');
    const qr = await h.e2e.as(buyer.token).get(`/directory/payments/orders/${created.id}/payment-qr`).expect(200);
    expect(Buffer.compare(qr.body as Buffer, h.logo)).toBe(0);
    for (const path of ['', '/payment-instructions', '/payment-qr', '/receipt']) {
      await h.e2e.as(stranger.token).get(`/directory/payments/orders/${created.id}${path}`).expect(404);
    }
    await h.e2e.as(stranger.token).post(`/directory/payments/orders/${created.id}/cancel`).expect(404);
    await uploadReceipt(h, stranger.token, created.id).expect(404);
    const asBusiness = await h.e2e.as(seller.token).get(`/directory/payments/orders/${created.id}/payment-instructions`);
    expect([asBusiness.status, asBusiness.body.code]).toEqual([403, 'ACCOUNT_KIND_NOT_ALLOWED']);
    await h.e2e.as(buyer.token).post(`/directory/payments/orders/${created.id}/cancel`).expect(200);
  });

  it('the receipt is private and encrypted: no static route serves it and the stored bytes are not the image', async () => {
    const created = await order(h, buyer.token, { listingId: seller.listingId });
    await uploadReceipt(h, buyer.token, created.id, Buffer.from('not an image')).expect(400);
    const sent = await uploadReceipt(h, buyer.token, created.id).expect(200);
    expect(sent.body.data).toMatchObject({ status: 'PENDING_VERIFICATION', receipt: { uploaded: true, reference: 'OP-123' } });
    const [row] = await h.select<{ key: string; sha: string }>('SELECT receipt_private_key AS key, receipt_sha256 AS sha FROM directory.payment_orders WHERE id = :id', { id: created.id });
    expect(row.key).toMatch(new RegExp(`^orders/${created.id}/receipt/[0-9a-f-]{36}\\.bin$`, 'u'));
    const path = join(resolve(env.MEDIA_STORAGE_LOCAL_ROOT), row.key);
    expect(existsSync(path)).toBe(true);
    const stored = readFileSync(path);
    expect(stored.equals(h.photo)).toBe(false);
    expect(stored.includes(h.photo.subarray(0, 64))).toBe(false);
    const app = express();
    mountLocalMedia(app);
    const base = new URL(env.MEDIA_STORAGE_PUBLIC_BASE_URL).pathname;
    await request(app).get(`${base}/${row.key}`).expect(404);
    await request(app).get(`${base}/${row.key.replace('orders/', '%6Frders/')}`).expect(404);
    const own = await h.e2e.as(buyer.token).get(`/directory/payments/orders/${created.id}/receipt`).expect(200);
    expect((own.body as Buffer).equals(h.photo)).toBe(true);
    const viewed = await h.e2e.as(seller.token).get(`/business/me/orders/${created.id}/receipt`).expect(200);
    expect((viewed.body as Buffer).equals(h.photo)).toBe(true);
    await h.e2e.as(seller.token).post(`/business/me/orders/${created.id}/confirm`).expect(200);
  });

  it("another business gets 404 on the order; persons, REPP's moderators and the platform admin get 403 on the inbox", async () => {
    const created = await order(h, buyer.token, { listingId: seller.listingId });
    await uploadReceipt(h, buyer.token, created.id).expect(200);
    const as = h.e2e.as(rival.token);
    for (const call of [
      () => as.get(`/business/me/orders/${created.id}`),
      () => as.get(`/business/me/orders/${created.id}/receipt`),
      () => as.post(`/business/me/orders/${created.id}/confirm`),
      () => as.post(`/business/me/orders/${created.id}/reject`).send({ reasonCode: 'UNREADABLE' }),
    ]) {
      expect((await call()).status).toBe(404);
    }
    expect(((await as.get('/business/me/orders').expect(200)).body.data.items as { id: string }[]).map((item) => item.id)).not.toContain(created.id);
    const moderator = await h.e2e.register('ord-moderator');
    await h.e2e.promote(moderator.id, 'MODERATOR');
    const platform = await h.e2e.platformAdmin('ord-platform');
    for (const actor of [buyer, moderator, platform]) {
      const refused = await h.e2e.as(actor.token).post(`/business/me/orders/${created.id}/confirm`);
      expect([refused.status, refused.body.code]).toEqual([403, 'ACCOUNT_KIND_NOT_ALLOWED']);
    }
    expect((await statusOf(created.id)).status).toBe('PENDING_VERIFICATION');
    await h.e2e.as(seller.token).post(`/business/me/orders/${created.id}/reject`).send({ reasonCode: 'NOT_RECEIVED' }).expect(200);
  });

  it('the inbox lists "Por confirmar" first; two confirmations at once confirm once; the buyer sees the timeline', async () => {
    const created = await order(h, buyer.token, { listingId: seller.listingId });
    await uploadReceipt(h, buyer.token, created.id).expect(200);
    const inbox = (await h.e2e.as(seller.token).get('/business/me/orders?limit=50').expect(200)).body.data;
    expect(inbox.pendingCount).toBeGreaterThanOrEqual(1);
    expect(inbox.items[0]).toMatchObject({ status: 'PENDING_VERIFICATION', actions: { canDecide: true }, buyer: { name: 'E2E ord-buyer' } });
    const responses = await Promise.all([1, 2].map(() => h.e2e.as(seller.token).post(`/business/me/orders/${created.id}/confirm`)));
    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    expect(responses.find((response) => response.status === 409)?.body.code).toBe('ORDER_INVALID_TRANSITION');
    const replay = await h.e2e.as(seller.token).post(`/business/me/orders/${created.id}/confirm`);
    expect([replay.status, replay.body.code]).toEqual([409, 'ORDER_INVALID_TRANSITION']);
    const seen = await statusOf(created.id);
    expect(seen.status).toBe('CONFIRMED');
    expect(seen.timeline.map((entry: { status: string; by: string }) => `${entry.status}:${entry.by}`)).toEqual([
      'PENDING_PAYMENT:BUYER',
      'PENDING_VERIFICATION:BUYER',
      'CONFIRMED:BUSINESS',
    ]);
    const [history] = await h.select<{ count: number }>('SELECT count(*)::int AS count FROM directory.payment_order_history WHERE order_id = :id AND to_status = \'CONFIRMED\'', { id: created.id });
    expect(history.count).toBe(1);
  });

  it('«Mis compras»: the buyer lists their orders newest first and pages with the cursor', async () => {
    const all = (await h.e2e.as(buyer.token).get('/directory/payments/orders/my-orders?limit=50').expect(200)).body.data;
    expect(all.items.length).toBeGreaterThanOrEqual(2);
    const created = all.items.map((item: { createdAt: string }) => item.createdAt);
    expect([...created].sort().reverse()).toEqual(created);
    const first = (await h.e2e.as(buyer.token).get('/directory/payments/orders/my-orders?limit=1').expect(200)).body.data;
    expect(first.items).toHaveLength(1);
    expect(first.nextCursor).toEqual(expect.any(String));
    const second = (await h.e2e.as(buyer.token).get(`/directory/payments/orders/my-orders?limit=1&cursor=${encodeURIComponent(first.nextCursor)}`).expect(200)).body.data;
    expect(second.items[0].id).toBe(all.items[1].id);
    const others = (await h.e2e.as(stranger.token).get('/directory/payments/orders/my-orders?limit=50').expect(200)).body.data;
    expect(others.items).toEqual([]);
  });

  it('stock: reserved at creation under a lock, 409 when exhausted, released on cancel and reject, consumed on confirm', async () => {
    const productId = await productOf(h, seller, 3);
    const first = await order(h, buyer.token, { listingId: productId, quantity: 2 });
    expect(first.amount).toBe('241.00');
    expect(await stockOf(h, productId)).toEqual({ quantity: 3, reserved: 2 });
    const exhausted = await h.e2e.as(stranger.token).post('/directory/payments/orders').send({ listingId: productId, quantity: 2 });
    expect([exhausted.status, exhausted.body.code, exhausted.body.details?.available]).toEqual([409, 'ORDER_OUT_OF_STOCK', 1]);
    await h.e2e.as(buyer.token).post(`/directory/payments/orders/${first.id}/cancel`).expect(200);
    expect(await stockOf(h, productId)).toEqual({ quantity: 3, reserved: 0 });

    const racers = await Promise.all([buyer, stranger].map((person) => h.e2e.as(person.token).post('/directory/payments/orders').send({ listingId: productId, quantity: 2 })));
    expect(racers.map((response) => response.status).sort()).toEqual([201, 409]);
    const won = racers.find((response) => response.status === 201)!.body.data as { id: string };
    const winner = racers[0].status === 201 ? buyer : stranger;
    await uploadReceipt(h, winner.token, won.id).expect(200);
    await h.e2e.as(seller.token).post(`/business/me/orders/${won.id}/reject`).send({ reasonCode: 'AMOUNT_MISMATCH' }).expect(200);
    expect(await stockOf(h, productId)).toEqual({ quantity: 3, reserved: 0 });
    // A new receipt after a rejection reserves the units again.
    await uploadReceipt(h, winner.token, won.id).expect(200);
    expect(await stockOf(h, productId)).toEqual({ quantity: 3, reserved: 2 });
    await h.e2e.as(seller.token).post(`/business/me/orders/${won.id}/confirm`).expect(200);
    expect(await stockOf(h, productId)).toEqual({ quantity: 1, reserved: 0 });
    await expect(h.e2e.sql('UPDATE directory.entity_plans SET stock_reserved = 2 WHERE id = :id', { id: productId })).rejects.toThrow(/ck_entity_plan_stock/u);
  });

  it('a buyer sends at most three receipts per order; the fourth is refused before anything is stored', async () => {
    const created = await order(h, buyer.token, { listingId: rival.listingId, note: 'Paso el lunes' });
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      await uploadReceipt(h, buyer.token, created.id).expect(200);
      await h.e2e.as(rival.token).post(`/business/me/orders/${created.id}/reject`).send({ reasonCode: 'UNREADABLE' }).expect(200);
    }
    const [before] = await h.select<{ key: string }>('SELECT receipt_private_key AS key FROM directory.payment_orders WHERE id = :id', { id: created.id });
    const fourth = await uploadReceipt(h, buyer.token, created.id);
    expect([fourth.status, fourth.body.code]).toEqual([409, 'ORDER_RECEIPT_LIMIT']);
    const [after] = await h.select<{ key: string }>('SELECT receipt_private_key AS key FROM directory.payment_orders WHERE id = :id', { id: created.id });
    expect(after.key).toBe(before.key);
    const seen = (await h.e2e.as(rival.token).get(`/business/me/orders/${created.id}`).expect(200)).body.data;
    expect(seen).toMatchObject({ status: 'REJECTED', note: 'Paso el lunes', rejection: { code: 'UNREADABLE' } });
    await h.e2e.as(buyer.token).post(`/directory/payments/orders/${created.id}/cancel`).expect(200);
  });

  it('expiry: an unpaid order past its deadline expires and frees its stock; the buyer sees it and is told', async () => {
    const productId = await productOf(h, seller, 5);
    const created = await order(h, buyer.token, { listingId: productId, quantity: 4 });
    expect(await stockOf(h, productId)).toEqual({ quantity: 5, reserved: 4 });
    await h.e2e.sql("UPDATE directory.payment_orders SET expires_at = now() - interval '1 minute' WHERE id = :id", { id: created.id });
    expect((await maintenance()).expired).toBeGreaterThanOrEqual(1);
    expect(await stockOf(h, productId)).toEqual({ quantity: 5, reserved: 0 });
    const seen = await statusOf(created.id);
    expect(seen).toMatchObject({ status: 'EXPIRED', cancelReason: 'EXPIRED', actions: { canUploadReceipt: false, canCancel: false } });
    expect(seen.timeline.at(-1)).toMatchObject({ status: 'EXPIRED', by: 'SYSTEM' });
    await uploadReceipt(h, buyer.token, created.id).expect(409);
    const notices = await h.select<{ count: number }>(
      `SELECT count(*)::int AS count FROM notifications.messages WHERE recipient_user_id = :id AND deduplication_key = :key`,
      { id: buyer.id, key: `payment-order:${created.id}:expired` },
    );
    expect(notices[0].count).toBe(1);
  });

  it('cash: only if the business accepts it; waits for the business without a receipt; reject OTHER needs a note', async () => {
    const refused = await h.e2e.as(buyer.token).post('/directory/payments/orders').send({ listingId: rival.listingId, method: 'CASH' });
    expect([refused.status, refused.body.code]).toEqual([409, 'ORDER_PAYMENT_METHOD_UNAVAILABLE']);
    const cash = await order(h, buyer.token, { listingId: seller.listingId, method: 'CASH' });
    expect(cash.status).toBe('PENDING_VERIFICATION');
    await uploadReceipt(h, buyer.token, cash.id).expect(409);
    const instructions = (await h.e2e.as(buyer.token).get(`/directory/payments/orders/${cash.id}/payment-instructions`).expect(200)).body.data;
    expect(instructions).toMatchObject({ method: 'CASH', bankName: null, qrPath: null });
    const noNote = await h.e2e.as(seller.token).post(`/business/me/orders/${cash.id}/reject`).send({ reasonCode: 'OTHER' });
    expect([noNote.status, noNote.body.code]).toEqual([422, 'ORDER_REJECTION_NOTE_REQUIRED']);
    await h.e2e.as(seller.token).post(`/business/me/orders/${cash.id}/reject`).send({ reasonCode: 'BOGUS' }).expect(400);
    await h.e2e.as(seller.token).post(`/business/me/orders/${cash.id}/confirm`).expect(200);
    expect((await statusOf(cash.id)).status).toBe('CONFIRMED');
  });

  it('a seller that stops being public: its unpaid orders are cancelled ("no pagues"); paid ones still wait for it', async () => {
    const shop = await sellerWithQr(h, 'ord-closing');
    const unpaid = await order(h, buyer.token, { listingId: shop.listingId });
    const paidBuyer = await h.e2e.register('ord-paid');
    const paid = await order(h, paidBuyer.token, { listingId: shop.listingId });
    await uploadReceipt(h, paidBuyer.token, paid.id).expect(200);
    await h.e2e.sql("UPDATE directory.entities SET status = 'SUSPENDED' WHERE id = :id", { id: shop.entityId });
    const blocked = await h.e2e.as(buyer.token).get(`/directory/payments/orders/${unpaid.id}/payment-instructions`);
    expect([blocked.status, blocked.body.code]).toEqual([409, 'ORDER_BUSINESS_UNAVAILABLE']);
    await maintenance();
    expect(await statusOf(unpaid.id)).toMatchObject({ status: 'CANCELLED', cancelReason: 'BUSINESS_UNAVAILABLE' });
    expect((await h.e2e.as(paidBuyer.token).get(`/directory/payments/orders/${paid.id}`).expect(200)).body.data.status).toBe('PENDING_VERIFICATION');
    await h.e2e.as(shop.token).post(`/business/me/orders/${paid.id}/confirm`).expect(200);
  });

  it('reminds the business at 24 h and 48 h of a receipt waiting for its decision, once each', async () => {
    const created = await order(h, stranger.token, { listingId: rival.listingId });
    await uploadReceipt(h, stranger.token, created.id).expect(200);
    const reminders = async () =>
      (await h.select<{ key: string }>(`SELECT deduplication_key AS key FROM notifications.messages WHERE recipient_user_id = :id AND deduplication_key LIKE :prefix ORDER BY created_at`, {
        id: rival.id,
        prefix: `payment-order:${created.id}:reminder:%`,
      })).map((row) => row.key.split(':').at(-1));
    await maintenance();
    expect(await reminders()).toEqual([]);
    await h.e2e.sql("UPDATE directory.payment_orders SET submitted_at = now() - interval '25 hours' WHERE id = :id", { id: created.id });
    await maintenance();
    await maintenance();
    expect(await reminders()).toEqual(['1']);
    await h.e2e.sql("UPDATE directory.payment_orders SET submitted_at = now() - interval '49 hours' WHERE id = :id", { id: created.id });
    await maintenance();
    expect(await reminders()).toEqual(['1', '2']);
    const metrics = await request(h.e2e.http).get(h.e2e.url('/health/metrics')).expect(200);
    expect(metrics.text).toMatch(/gym_sheet_orders_undecided_overdue [1-9]/u);
  });
});
