import { canonicalEmail, hashEmail } from './email-hash';

const secret = 'unit-privacy-pepper-0123456789abcdef';

describe('hashEmail', () => {
  it('hashes every alias of one mailbox alike (ban evasion through +suffix or Gmail dots)', () => {
    const base = hashEmail('ana.perez@gmail.com', secret);
    for (const alias of ['AnaPerez@gmail.com', 'a.n.a.perez+repp@gmail.com', ' anaperez@googlemail.com ', 'ana.perez+x+y@GoogleMail.com']) {
      expect([alias, hashEmail(alias, secret)]).toEqual([alias, base]);
    }
    expect(hashEmail('ana+gym@example.test', secret)).toBe(hashEmail('ANA@example.test', secret));
  });

  it('keeps distinct mailboxes apart: dots only collapse for Gmail', () => {
    expect(hashEmail('ana.perez@example.test', secret)).not.toBe(hashEmail('anaperez@example.test', secret));
    expect(hashEmail('ana@gmail.com', secret)).not.toBe(hashEmail('ana@example.test', secret));
    expect(canonicalEmail('+ana@example.test')).toBe('+ana@example.test');
  });

  it('stores nothing without the pepper or an address', () => {
    expect(hashEmail('ana@example.test', null)).toBeNull();
    expect(hashEmail('   ', secret)).toBeNull();
  });
});
