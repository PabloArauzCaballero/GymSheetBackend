/* eslint-disable @typescript-eslint/no-unsafe-member-access --
   supertest types response bodies as `any`; these helpers only forward them to the suites. */
import request from 'supertest';
import { KycBusiness, KycHarness, letters } from './kyc-e2e';

/** A business whose KYC was approved automatically: its listing is public (ACTIVE). */
export async function publishedBusiness(h: KycHarness, label: string, entityType = 'GYM'): Promise<KycBusiness> {
  const owner = entityType === 'GYM' ? await h.ready(label) : await readyOfType(h, label, entityType);
  const submit = await h.e2e.as(owner.token).post('/business/me/kyc/submit').expect(200);
  if (submit.body.data.status !== 'AUTO_APPROVED') throw new Error(`KYC ${submit.body.data.status}: ${JSON.stringify(submit.body.data)}`);
  return owner;
}

async function readyOfType(h: KycHarness, label: string, entityType: string): Promise<KycBusiness> {
  const owner = await h.business(label, { entityType });
  await h.verifyPhone(owner);
  await h.legal(owner, {});
  await h.documents(owner);
  return owner;
}

/** A membership listing with sane defaults; `patch` overrides any field. */
export function membership(patch: Record<string, unknown> = {}) {
  return {
    offerKind: 'MEMBERSHIP',
    name: `Plan mensual ${letters(6)}`,
    description: 'Acceso libre a sala y clases.',
    benefits: ['Sala de pesas', 'Clases grupales'],
    price: 250,
    validityDays: 30,
    ...patch,
  };
}

export async function createListing(h: KycHarness, owner: KycBusiness, body: Record<string, unknown> = membership()) {
  const response = await h.e2e.as(owner.token).post('/business/me/listings').send(body);
  if (response.status !== 201) throw new Error(`create listing ${response.status} ${JSON.stringify(response.body)}`);
  return response.body.data as { id: string; moderationStatus: string; visibility: string; autoCheckCodes: string[] };
}

export function publicGet(h: KycHarness, path: string) {
  return request(h.e2e.http).get(h.e2e.url(path));
}

/** Ids of the listings a public search returns. */
export async function publicIds(h: KycHarness, query: string): Promise<string[]> {
  const response = await publicGet(h, `/public/directory/listings?${query}`).expect(200);
  return (response.body.data.items as { id: string }[]).map((item) => item.id);
}
