/* eslint-disable @typescript-eslint/no-unsafe-member-access --
   supertest types response bodies as `any`; these helpers only forward them to the suites. */
import { existsSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { env } from '../../src/config/env';
import { KycBusiness, KycHarness } from './kyc-e2e';
import { createListing, membership, publishedBusiness } from './listings-e2e';

export type Seller = KycBusiness & { listingId: string };

/**
 * A published business with its payment data (holder = its KYC representative), its QR and one
 * membership listing. A CENTER by default: a GYM's membership also needs the buyer's SOCIO
 * affiliation (ADR-0026), which the subscription suites exercise on their own.
 */
export async function sellerWithQr(h: KycHarness, label: string, options: { acceptsCash?: boolean; entityType?: string } = {}): Promise<Seller> {
  const owner = await publishedBusiness(h, label, options.entityType ?? 'CENTER');
  await h.e2e
    .as(owner.token)
    .put('/business/me/payment-config')
    .send({ bankName: 'Banco Unión', accountHolderName: 'Representante Prueba', accountNumber: '1000-2000', acceptsCash: options.acceptsCash ?? false })
    .expect(200);
  await h.e2e.as(owner.token).put('/business/me/payment-config/qr').attach('file', h.logo, { filename: 'qr.png', contentType: 'image/png' }).expect(200);
  const listing = await createListing(h, owner, membership());
  return { ...owner, listingId: listing.id };
}

export async function productOf(h: KycHarness, seller: KycBusiness, stockQuantity: number): Promise<string> {
  const listing = await createListing(h, seller, {
    offerKind: 'PRODUCT',
    name: `Proteína ${Math.random().toString(36).slice(2, 8)}`,
    description: 'Proteína de suero, dos kilos.',
    price: 120.5,
    stockQuantity,
  });
  return listing.id;
}

export async function order(h: KycHarness, buyerToken: string, body: Record<string, unknown>) {
  const response = await h.e2e.as(buyerToken).post('/directory/payments/orders').send(body);
  if (response.status !== 201) throw new Error(`order ${response.status} ${JSON.stringify(response.body)}`);
  return response.body.data as { id: string; status: string; amount: string; unitAmount: string; quantity: number };
}

export function uploadReceipt(h: KycHarness, buyerToken: string, orderId: string, image: Buffer = h.photo) {
  return h.e2e.as(buyerToken).post(`/directory/payments/orders/${orderId}/receipt`).field('reference', 'OP-123').attach('file', image, { filename: 'r.jpg', contentType: 'image/jpeg' });
}

export async function stockOf(h: KycHarness, listingId: string): Promise<{ quantity: number | null; reserved: number }> {
  const [row] = await h.select<{ quantity: number | null; reserved: number }>(
    'SELECT stock_quantity AS quantity, stock_reserved AS reserved FROM directory.entity_plans WHERE id = :listingId',
    { listingId },
  );
  return row;
}

/** Receipts live under `orders/{orderId}/` on the local disk; the suite removes what it stored. */
export async function removeReceipts(h: KycHarness): Promise<void> {
  const rows = await h.select<{ key: string }>(
    `SELECT receipt_private_key AS key FROM directory.payment_orders WHERE receipt_private_key IS NOT NULL AND created_at > now() - interval '1 hour'`,
  );
  for (const { key } of rows) {
    const folder = join(resolve(env.MEDIA_STORAGE_LOCAL_ROOT), key.split('/').slice(0, 2).join('/'));
    if (existsSync(folder)) rmSync(folder, { recursive: true, force: true });
  }
}
