/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call --
   supertest types response bodies as `any`; these helpers only forward them to the suites. */
import { existsSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { randomInt } from 'node:crypto';
import request from 'supertest';
import sharp from 'sharp';
import { QueryTypes } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import { env } from '../../src/config/env';
import { PHONE_OTP_SENDER, PhoneOtpDelivery, PhoneOtpSender } from '../../src/modules/business-kyc/phone/phone-otp.port';
import { E2eApp, bootE2eApp, markEmailVerified } from './e2e-app';

/** Test-only sender wired in place of the configured one: it keeps the last code per phone. */
export class CapturingOtpSender implements PhoneOtpSender {
  readonly name = 'e2e-capture';
  available = true;
  readonly codes = new Map<string, string>();

  send(phone: string, code: string): Promise<PhoneOtpDelivery> {
    this.codes.set(phone, code);
    return Promise.resolve({ delivered: true });
  }
}

const mutableEnv = env as { KYC_ENCRYPTION_KEY?: string; IP_HASH_SECRET?: string; BUSINESS_SIGNUP_ENABLED: boolean };

export type KycBusiness = { id: string; token: string; entityId: string; email: string; name: string; handle: string; phone: string };

/** Random lowercase letters: names and handles that never look like each other across runs (trigram similarity). */
export function letters(length: number): string {
  return Array.from({ length }, () => 'abcdefghjkmnpqrstuvwxyz'[randomInt(23)]).join('');
}

export function randomDigits(length: number): string {
  return Array.from({ length }, (_, index) => String(index === 0 ? randomInt(1, 10) : randomInt(10))).join('');
}

export type KycHarness = {
  e2e: E2eApp;
  sequelize: Sequelize;
  sender: CapturingOtpSender;
  photo: Buffer;
  logo: Buffer;
  select: <T extends object>(sql: string, replacements?: Record<string, unknown>) => Promise<T[]>;
  /** Signup, verified email, step 3 (category, city, handle) and, for a company, its logo. */
  business: (label: string, options?: { entityType?: string; email?: string; risk?: 'LOW' | 'MEDIUM' | 'HIGH' }) => Promise<KycBusiness>;
  verifyPhone: (owner: KycBusiness) => Promise<void>;
  legal: (owner: KycBusiness, input: { nit?: string; ci?: string }) => Promise<void>;
  documents: (owner: KycBusiness) => Promise<void>;
  /** Everything up to a submit that passes every check. */
  ready: (label: string, options?: { nit?: string; email?: string }) => Promise<KycBusiness>;
  close: () => Promise<void>;
};

export async function bootKycHarness(): Promise<KycHarness> {
  const sender = new CapturingOtpSender();
  const e2e = await bootE2eApp((builder) => builder.overrideProvider(PHONE_OTP_SENDER).useValue(sender));
  const sequelize = e2e.app.get(Sequelize);
  const before = { key: mutableEnv.KYC_ENCRYPTION_KEY, pepper: mutableEnv.IP_HASH_SECRET, signup: mutableEnv.BUSINESS_SIGNUP_ENABLED };
  mutableEnv.KYC_ENCRYPTION_KEY = 'e2e-kyc-encryption-key-0123456789abcdef';
  mutableEnv.IP_HASH_SECRET = before.pepper ?? 'e2e-privacy-pepper-0123456789abcdef0123';
  mutableEnv.BUSINESS_SIGNUP_ENABLED = true;
  const legalSet = (await request(e2e.http).get(e2e.url('/legal/current?accountKind=BUSINESS')).expect(200)).body.data;
  const [{ id: categoryId }] = await sequelize.query<{ id: string }>(
    `SELECT id FROM directory.categories WHERE entity_scope IN ('GYM', 'ALL') AND is_active ORDER BY display_order LIMIT 1`,
    { type: QueryTypes.SELECT },
  );
  const photo = await sharp({ create: { width: 1000, height: 820, channels: 3, background: '#888', noise: { type: 'gaussian', mean: 128, sigma: 60 } } })
    .jpeg({ quality: 60 })
    .toBuffer();
  const logo = await sharp({ create: { width: 64, height: 64, channels: 3, background: '#1e88e5' } }).png().toBuffer();
  const created: string[] = [];

  const select = <T extends object>(sql: string, replacements: Record<string, unknown> = {}) =>
    sequelize.query<T>(sql, { type: QueryTypes.SELECT, replacements });

  const business: KycHarness['business'] = async (label, options = {}) => {
    const name = `${label.slice(0, 12)} ${letters(14)}`;
    const email = options.email ?? `${label}-${letters(8)}@example.test`;
    const ticket = await request(e2e.http).get(e2e.url('/auth/register/ticket')).expect(200);
    const response = await request(e2e.http)
      .post(e2e.url('/business/signup'))
      .send({
        ticket: ticket.body.data.ticket,
        email,
        password: 'e2e-strong-password',
        businessName: name,
        entityType: options.entityType ?? 'GYM',
        acceptances: legalSet.documents.map(({ document, version, contentSha256 }: { document: string; version: string; contentSha256: string | null }) => ({
          document,
          version,
          ...(contentSha256 ? { contentSha256 } : {}),
        })),
      });
    if (response.status !== 201) throw new Error(`signup ${response.status} ${JSON.stringify(response.body)}`);
    const id = response.body.data.user.id as string;
    created.push(id);
    await markEmailVerified(e2e.app, id);
    // Without Turnstile or attestation in e2e the anti-bot layer scores the signup HIGH (its own suite
    // covers that); a LOW signup is the case under test unless the caller asks otherwise.
    await e2e.sql('UPDATE public.usuarios SET signup_risk = :risk WHERE id = :id', { id, risk: options.risk ?? 'LOW' });
    const token = response.body.data.accessToken as string;
    const handle = `${letters(10)}.kyc`;
    await e2e.as(token).patch('/business/me/profile').send({ primaryCategoryId: categoryId, city: 'La Paz' }).expect(200);
    await e2e.as(token).put('/business/me/handle').send({ handle }).expect(200);
    await e2e.as(token).post('/business/me/media').field('slot', 'LOGO').attach('file', logo, { filename: 'logo.png', contentType: 'image/png' }).expect(201);
    return { id, token, entityId: response.body.data.business.entityId as string, email, name, handle, phone: `7${randomDigits(7)}` };
  };

  const verifyPhone: KycHarness['verifyPhone'] = async (owner) => {
    await e2e.as(owner.token).post('/business/me/phone/verify/request').send({ phone: owner.phone }).expect(202);
    const code = sender.codes.get(`+591${owner.phone}`);
    if (!code) throw new Error('no code captured');
    await e2e.as(owner.token).post('/business/me/phone/verify/confirm').send({ code }).expect(200);
  };

  const legal: KycHarness['legal'] = async (owner, input) => {
    await e2e
      .as(owner.token)
      .put('/business/me/kyc/draft')
      .send({ legalName: `${owner.name} S.R.L.`, nit: input.nit ?? randomDigits(10), repFullName: 'Representante Prueba', repCiNumber: input.ci ?? randomDigits(7), repCiExtension: 'LP', address: 'Av. Arce 123' })
      .expect(200);
  };

  const documents: KycHarness['documents'] = async (owner) => {
    for (const kind of ['CI_FRONT', 'CI_BACK']) {
      await e2e.as(owner.token).post('/business/me/kyc/documents').field('kind', kind).attach('file', photo, { filename: 'ci.jpg', contentType: 'image/jpeg' }).expect(201);
    }
    await e2e.as(owner.token).put('/business/me/kyc/consent').send({ granted: true, version: '2026-11-16' }).expect(200);
    await e2e.as(owner.token).post('/business/me/kyc/selfie-challenge').expect(201);
    await e2e.as(owner.token).post('/business/me/kyc/documents').field('kind', 'SELFIE').attach('file', photo, { filename: 'selfie.jpg', contentType: 'image/jpeg' }).expect(201);
  };

  return {
    e2e,
    sequelize,
    sender,
    photo,
    logo,
    select,
    business,
    verifyPhone,
    legal,
    documents,
    ready: async (label, options = {}) => {
      const owner = await business(label, { email: options.email });
      await verifyPhone(owner);
      await legal(owner, { nit: options.nit });
      await documents(owner);
      return owner;
    },
    close: async () => {
      // Every stored file this suite created lives under the accounts' and listings' folders.
      const root = resolve(env.MEDIA_STORAGE_LOCAL_ROOT);
      for (const id of created) {
        const [row] = await select<{ entityId: string }>('SELECT entity_id AS "entityId" FROM business.accounts WHERE user_id = :id', { id });
        for (const folder of [id, row?.entityId]) {
          const path = folder ? join(root, 'business', folder) : null;
          if (path && existsSync(path)) rmSync(path, { recursive: true, force: true });
        }
      }
      mutableEnv.KYC_ENCRYPTION_KEY = before.key;
      if (before.pepper === undefined) delete mutableEnv.IP_HASH_SECRET;
      else mutableEnv.IP_HASH_SECRET = before.pepper;
      mutableEnv.BUSINESS_SIGNUP_ENABLED = before.signup;
      await e2e.app.close();
    },
  };
}
