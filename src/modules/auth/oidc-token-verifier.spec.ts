import { ServiceUnavailableException } from '@nestjs/common';
import { createHash, generateKeyPairSync, KeyObject, sign } from 'node:crypto';
import { env } from '../../config/env';
import { OidcTokenVerifier } from './oidc-token-verifier';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const intruder = generateKeyPairSync('rsa', { modulusLength: 2048 });
const KID = 'test-key-1';

function jwks(key: KeyObject = publicKey, kid = KID) {
  return { keys: [{ ...key.export({ format: 'jwk' }), kid, alg: 'RS256', use: 'sig' }] };
}

function token(claims: Record<string, unknown>, options: { key?: KeyObject; kid?: string; alg?: string } = {}): string {
  const header = Buffer.from(JSON.stringify({ alg: options.alg ?? 'RS256', kid: options.kid ?? KID })).toString('base64url');
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  const signature = sign('sha256', Buffer.from(`${header}.${payload}`), options.key ?? privateKey);
  return `${header}.${payload}.${signature.toString('base64url')}`;
}

const now = () => Math.floor(Date.now() / 1000);
const googleClaims = (overrides: Record<string, unknown> = {}) => ({
  iss: 'https://accounts.google.com',
  aud: 'google-web-client',
  sub: '1098765432',
  email: 'Ana@Gmail.com',
  email_verified: true,
  iat: now(),
  exp: now() + 600,
  ...overrides,
});

describe('OidcTokenVerifier', () => {
  beforeEach(() => {
    jest.replaceProperty(env, 'GOOGLE_CLIENT_IDS', ['google-web-client', 'google-ios-client']);
    jest.replaceProperty(env, 'APPLE_CLIENT_IDS', ['com.gymsheet.app']);
  });
  afterEach(() => jest.restoreAllMocks());

  it('accepts a well-signed Google token and normalizes the email', async () => {
    const fetcher = jest.fn().mockResolvedValue(jwks());
    const verifier = new OidcTokenVerifier(fetcher);
    await expect(verifier.verify('GOOGLE', token(googleClaims()))).resolves.toEqual({
      provider: 'GOOGLE',
      subject: '1098765432',
      email: 'ana@gmail.com',
      emailVerified: true,
    });
    expect(fetcher).toHaveBeenCalledWith('https://www.googleapis.com/oauth2/v3/certs');
  });

  it('caches keys by kid instead of fetching on every sign-in', async () => {
    const fetcher = jest.fn().mockResolvedValue(jwks());
    const verifier = new OidcTokenVerifier(fetcher);
    await verifier.verify('GOOGLE', token(googleClaims()));
    await verifier.verify('GOOGLE', token(googleClaims()));
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['a token signed by another key', token(googleClaims(), { key: intruder.privateKey })],
    ['an unknown kid', token(googleClaims(), { kid: 'other-kid' })],
    ['a non-RS256 header', token(googleClaims(), { alg: 'HS256' })],
    ['a foreign audience', token(googleClaims({ aud: 'someone-else' }))],
    ['a foreign issuer', token(googleClaims({ iss: 'https://evil.example' }))],
    ['an expired token', token(googleClaims({ exp: now() - 3600 }))],
    ['a missing subject', token(googleClaims({ sub: '' }))],
    ['garbage', 'not.a.jwt'],
  ])('rejects %s with IDENTITY_TOKEN_INVALID', async (_label, candidate) => {
    const verifier = new OidcTokenVerifier(jest.fn().mockResolvedValue(jwks()));
    await expect(verifier.verify('GOOGLE', candidate)).rejects.toMatchObject({ code: 'IDENTITY_TOKEN_INVALID' });
  });

  it('checks the nonce only when the client sent one', async () => {
    const verifier = new OidcTokenVerifier(jest.fn().mockResolvedValue(jwks()));
    const withNonce = token(googleClaims({ nonce: 'n-123' }));
    await expect(verifier.verify('GOOGLE', withNonce, 'n-123')).resolves.toMatchObject({ subject: '1098765432' });
    await expect(verifier.verify('GOOGLE', withNonce, 'other')).rejects.toMatchObject({ code: 'IDENTITY_TOKEN_INVALID' });
    await expect(verifier.verify('GOOGLE', token(googleClaims()), 'n-123')).rejects.toMatchObject({
      code: 'IDENTITY_TOKEN_INVALID',
    });
  });

  it('reports an unverified Google email as such', async () => {
    const verifier = new OidcTokenVerifier(jest.fn().mockResolvedValue(jwks()));
    await expect(verifier.verify('GOOGLE', token(googleClaims({ email_verified: false })))).resolves.toMatchObject({
      emailVerified: false,
    });
  });

  it('verifies Apple tokens, treats the email as verified and accepts a hashed nonce', async () => {
    const fetcher = jest.fn().mockResolvedValue(jwks());
    const verifier = new OidcTokenVerifier(fetcher);
    const hashed = createHash('sha256').update('raw-nonce').digest('hex');
    const appleToken = token({
      iss: 'https://appleid.apple.com',
      aud: 'com.gymsheet.app',
      sub: '001234.abcdef',
      email: 'x1y2@privaterelay.appleid.com',
      email_verified: 'false',
      nonce: hashed,
      iat: now(),
      exp: now() + 600,
    });
    await expect(verifier.verify('APPLE', appleToken, 'raw-nonce')).resolves.toEqual({
      provider: 'APPLE',
      subject: '001234.abcdef',
      email: 'x1y2@privaterelay.appleid.com',
      emailVerified: true,
    });
    expect(fetcher).toHaveBeenCalledWith('https://appleid.apple.com/auth/keys');
  });

  it('answers 503 when the provider keys cannot be fetched and none are cached', async () => {
    const verifier = new OidcTokenVerifier(jest.fn().mockRejectedValue(new Error('offline')));
    await expect(verifier.verify('GOOGLE', token(googleClaims()))).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
