import { hashOpaqueToken, issueOpaqueToken, issuePasswordResetPin } from './token-hash.util';

describe('token-hash.util', () => {
  it('issues a 64-character hex raw token and a 64-character hex hash', () => {
    const { rawToken, tokenHash } = issueOpaqueToken('refresh');

    expect(rawToken).toMatch(/^[0-9a-f]{64}$/);
    expect(tokenHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('issues different raw tokens on each call', () => {
    const first = issueOpaqueToken('refresh');
    const second = issueOpaqueToken('refresh');

    expect(first.rawToken).not.toBe(second.rawToken);
    expect(first.tokenHash).not.toBe(second.tokenHash);
  });

  it('rehashing the same raw token under the same purpose reproduces the same hash', () => {
    const { rawToken, tokenHash } = issueOpaqueToken('password-reset');

    expect(hashOpaqueToken('password-reset', rawToken)).toBe(tokenHash);
  });

  it('scopes the hash by purpose, so the same raw bytes never collide across token types', () => {
    const { rawToken } = issueOpaqueToken('refresh');

    expect(hashOpaqueToken('refresh', rawToken)).not.toBe(hashOpaqueToken('password-reset', rawToken));
  });
});

describe('issuePasswordResetPin', () => {
  it('issues a 6-digit numeric PIN, zero-padded, and its hash', () => {
    const { rawPin, pinHash } = issuePasswordResetPin();

    expect(rawPin).toMatch(/^\d{6}$/);
    expect(pinHash).toBe(hashOpaqueToken('password-reset', rawPin));
  });

  it('produces PINs across the full range, including ones that need zero-padding', () => {
    // Deterministic against the tiny chance of flaking: draw enough PINs that
    // seeing none under 100000 (which would print with fewer than 6 digits
    // without padStart) is effectively impossible if padding were broken.
    const pins = Array.from({ length: 200 }, () => issuePasswordResetPin().rawPin);

    expect(pins.every((pin) => pin.length === 6)).toBe(true);
  });
});
