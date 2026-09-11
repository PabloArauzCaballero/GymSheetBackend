import { hashOpaqueToken, issueOpaqueToken } from './token-hash.util';

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
    const { rawToken, tokenHash } = issueOpaqueToken('refresh');

    expect(hashOpaqueToken('refresh', rawToken)).toBe(tokenHash);
  });

  // El hash nunca contiene el valor en claro: quien lea la tabla no puede
  // presentar de vuelta a la API lo que encuentre allí.
  it('never embeds the raw token in its hash', () => {
    const { rawToken, tokenHash } = issueOpaqueToken('refresh');

    expect(tokenHash).not.toContain(rawToken);
    expect(tokenHash).not.toBe(rawToken);
  });
});
