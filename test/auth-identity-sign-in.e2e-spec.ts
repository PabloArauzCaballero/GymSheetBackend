import { generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import { QueryTypes } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import request from 'supertest';
import { env } from '../src/config/env';
import { JWKS_FETCHER } from '../src/modules/auth/oidc-token-verifier';
import { bootE2eApp, E2E_SIGNUP_FIELDS, E2eApp } from './support/e2e-app';

/**
 * Google / Apple sign-in against locally generated RSA keys: the JWKS fetcher
 * is stubbed, so nothing here touches the network.
 */
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const KID = 'e2e-key';
const GOOGLE_CLIENT = 'e2e-google-client';
const jwks = { keys: [{ ...publicKey.export({ format: 'jwk' }), kid: KID, alg: 'RS256', use: 'sig' }] };

function idToken(claims: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', kid: KID })).toString('base64url');
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  return `${header}.${payload}.${sign('sha256', Buffer.from(`${header}.${payload}`), privateKey).toString('base64url')}`;
}

const now = () => Math.floor(Date.now() / 1000);
const google = (subject: string, email: string, extra: Record<string, unknown> = {}) =>
  idToken({
    iss: 'https://accounts.google.com',
    aud: GOOGLE_CLIENT,
    sub: subject,
    email,
    email_verified: true,
    iat: now(),
    exp: now() + 600,
    ...extra,
  });

describe('Google / Apple sign-in (e2e)', () => {
  let e2e: E2eApp;
  const fetchJwks = jest.fn(() => Promise.resolve(jwks));
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const profile = { nombreCompleto: 'Gina Google', ...E2E_SIGNUP_FIELDS };

  beforeAll(async () => {
    e2e = await bootE2eApp((builder) => builder.overrideProvider(JWKS_FETCHER).useValue(fetchJwks));
  }, 60_000);
  afterAll(async () => {
    await e2e?.app.close();
  });
  afterEach(() => jest.restoreAllMocks());

  const enableGoogle = () => {
    jest.replaceProperty(env, 'AUTH_GOOGLE_ENABLED', true);
    jest.replaceProperty(env, 'GOOGLE_CLIENT_IDS', [GOOGLE_CLIENT]);
  };

  it('answers 404 while the provider flags are off, whatever the body', async () => {
    await request(e2e.http).post(e2e.url('/auth/google')).send({ idToken: google('s', 'a@x.test') }).expect(404);
    await request(e2e.http).post(e2e.url('/auth/google')).send({}).expect(404);
    await request(e2e.http).post(e2e.url('/auth/apple')).send({ identityToken: 'x'.repeat(30) }).expect(404);
    await request(e2e.http).post(e2e.url('/auth/google/complete')).send({}).expect(404);
    expect(fetchJwks).not.toHaveBeenCalled();
  });

  it('creates a verified account after profile completion, then logs the same subject straight in', async () => {
    enableGoogle();
    const subject = `google-${randomUUID()}`;
    const email = `gina-${suffix}@example.test`;
    const installation = randomUUID();

    const first = await request(e2e.http).post(e2e.url('/auth/google')).send({ idToken: google(subject, email) }).expect(200);
    expect(first.body.data).toMatchObject({ status: 'PROFILE_COMPLETION_REQUIRED', email });
    const signupToken = first.body.data.signupToken as string;
    // The signup token is not an access token.
    await request(e2e.http).get(e2e.url('/auth/me')).set('Authorization', `Bearer ${signupToken}`).expect(401);

    await request(e2e.http)
      .post(e2e.url('/auth/google/complete'))
      .send({ signupToken, ...profile, fechaNacimiento: '2015-01-01' })
      .expect(400);
    const completed = await request(e2e.http)
      .post(e2e.url('/auth/google/complete'))
      .set('X-Installation-Id', installation)
      .set('X-Client-Platform', 'ios')
      .send({ signupToken, ...profile })
      .expect(200);
    expect(completed.body.data).toMatchObject({ status: 'AUTHENTICATED', user: { email, emailVerified: true } });
    const api = e2e.as(completed.body.data.accessToken as string);
    expect((await api.get('/auth/me').expect(200)).body.data.emailVerified).toBe(true);
    expect((await api.get('/me/devices').expect(200)).body.data).toHaveLength(1);
    // Social is open right away, legal acceptance is on record (no 428).
    expect((await api.get('/me/discovery/deck')).status).not.toBe(403);

    // Replaying the completion cannot create a second account.
    await request(e2e.http).post(e2e.url('/auth/google/complete')).send({ signupToken, ...profile }).expect(409);

    const again = await request(e2e.http).post(e2e.url('/auth/google')).send({ idToken: google(subject, email) }).expect(200);
    expect(again.body.data).toMatchObject({ status: 'AUTHENTICATED', user: { id: completed.body.data.user.id } });
  });

  it('links an existing password account with the same verified email and verifies it', async () => {
    enableGoogle();
    const email = `linked-${suffix}@example.test`;
    const registered = await request(e2e.http)
      .post(e2e.url('/auth/register'))
      .send({ email, password: 'linked-e2e-password', nombreCompleto: 'Linked Person', ...E2E_SIGNUP_FIELDS })
      .expect(201);
    expect(registered.body.data.user.emailVerified).toBe(false);

    const signedIn = await request(e2e.http)
      .post(e2e.url('/auth/google'))
      .send({ idToken: google(`google-${randomUUID()}`, email.toUpperCase(), { nonce: 'n-1' }), nonce: 'n-1' })
      .expect(200);
    expect(signedIn.body.data).toMatchObject({
      status: 'AUTHENTICATED',
      user: { id: registered.body.data.user.id, emailVerified: true },
    });
    const links = await e2e.app.get(Sequelize).query('SELECT provider FROM auth.identities WHERE user_id = :userId', {
      type: QueryTypes.SELECT,
      replacements: { userId: registered.body.data.user.id },
    });
    expect(links).toEqual([{ provider: 'GOOGLE' }]);
  });

  it('rejects forged, foreign, unverified and nonce-mismatched tokens', async () => {
    enableGoogle();
    const forger = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const header = Buffer.from(JSON.stringify({ alg: 'RS256', kid: KID })).toString('base64url');
    const payload = Buffer.from(
      JSON.stringify({ iss: 'https://accounts.google.com', aud: GOOGLE_CLIENT, sub: 'x', email: 'x@x.test', exp: now() + 600 }),
    ).toString('base64url');
    const forged = `${header}.${payload}.${sign('sha256', Buffer.from(`${header}.${payload}`), forger.privateKey).toString('base64url')}`;

    const post = (body: Record<string, unknown>) => request(e2e.http).post(e2e.url('/auth/google')).send(body);
    expect((await post({ idToken: forged }).expect(401)).body.code).toBe('IDENTITY_TOKEN_INVALID');
    expect((await post({ idToken: google('s', 'a@x.test', { aud: 'other' }) }).expect(401)).body.code).toBe(
      'IDENTITY_TOKEN_INVALID',
    );
    expect((await post({ idToken: google('s', 'a@x.test', { exp: now() - 3600 }) }).expect(401)).body.code).toBe(
      'IDENTITY_TOKEN_INVALID',
    );
    expect((await post({ idToken: google('s', 'a@x.test'), nonce: 'expected' }).expect(401)).body.code).toBe(
      'IDENTITY_TOKEN_INVALID',
    );
    expect((await post({ idToken: google('s', 'a@x.test', { email_verified: false }) }).expect(403)).body.code).toBe(
      'IDENTITY_EMAIL_UNVERIFIED',
    );
    await post({ idToken: 'short' }).expect(400);
  });
});
