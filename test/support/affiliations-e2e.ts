/* eslint-disable @typescript-eslint/no-unsafe-member-access --
   supertest types response bodies as `any`; these helpers only forward them to the suites. */
import { KycBusiness, KycHarness, letters, randomDigits } from './kyc-e2e';
import { publishedBusiness } from './listings-e2e';

export type Gym = KycBusiness & { locations: string[] };

/** A public gym with two declared locations. */
export async function gymWithLocations(h: KycHarness, label: string): Promise<Gym> {
  const owner = await publishedBusiness(h, label);
  const locations: string[] = [];
  for (const name of ['Sede Centro', 'Sede Sur']) {
    const response = await h.e2e.as(owner.token).post('/business/me/locations').send({ name: `${name} ${letters(4)}`, city: 'La Paz' }).expect(201);
    locations.push(response.body.data.id as string);
  }
  return { ...owner, locations };
}

/** A coach business (INDIVIDUAL KYC: CI, selfie and specialty) approved automatically: public. */
export async function publishedCoach(h: KycHarness, label: string): Promise<KycBusiness> {
  const owner = await h.business(label, { entityType: 'COACH' });
  await h.verifyPhone(owner);
  await h.e2e
    .as(owner.token)
    .put('/business/me/kyc/draft')
    .send({ repFullName: 'Coach Prueba', repCiNumber: randomDigits(7), repCiExtension: 'LP', specialty: 'Fuerza y acondicionamiento' })
    .expect(200);
  await h.documents(owner);
  const submit = await h.e2e.as(owner.token).post('/business/me/kyc/submit').expect(200);
  if (submit.body.data.status !== 'AUTO_APPROVED') throw new Error(`KYC ${submit.body.data.status}: ${JSON.stringify(submit.body.data)}`);
  return owner;
}

export function requestAt(h: KycHarness, token: string, body: Record<string, unknown>) {
  return h.e2e.as(token).post('/me/affiliations').send(body);
}

/** A SOCIO request that must succeed; returns the created affiliation's id. */
export async function socioAt(h: KycHarness, token: string, gym: Gym, extra: Record<string, unknown> = {}): Promise<string> {
  const response = await requestAt(h, token, { gymHandle: `@${gym.handle}`, kind: 'SOCIO', locationId: gym.locations[0], ciLast3: '123', ...extra });
  if (response.status !== 201) throw new Error(`socio ${response.status} ${JSON.stringify(response.body)}`);
  return response.body.data.id as string;
}

export function confirm(h: KycHarness, gym: KycBusiness, affiliationId: string) {
  return h.e2e.as(gym.token).post(`/business/me/affiliations/${affiliationId}/confirm`);
}

export async function statusOf(h: KycHarness, affiliationId: string): Promise<{ status: string; reasonCode: string | null; ciLast3: string | null }> {
  const [row] = await h.select<{ status: string; reasonCode: string | null; ciLast3: string | null }>(
    'SELECT status, reason_code AS "reasonCode", ci_last3 AS "ciLast3" FROM directory.affiliations WHERE id = :affiliationId',
    { affiliationId },
  );
  return row;
}

export async function historyOf(h: KycHarness, affiliationId: string): Promise<string[]> {
  const rows = await h.select<{ step: string }>(
    `SELECT coalesce(from_status, '-') || '>' || to_status || ':' || coalesce(reason_code, '') AS step
       FROM directory.affiliation_history WHERE affiliation_id = :affiliationId ORDER BY at, id`,
    { affiliationId },
  );
  return rows.map((row) => row.step);
}

export async function noticeKeys(h: KycHarness, userId: string): Promise<string[]> {
  const rows = await h.select<{ key: string }>(
    `SELECT deduplication_key AS key FROM notifications.messages WHERE recipient_user_id = :userId AND deduplication_key LIKE 'affiliation:%' ORDER BY created_at`,
    { userId },
  );
  return rows.map((row) => row.key);
}
