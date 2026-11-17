import { KycBusiness, KycHarness, bootKycHarness, letters } from './support/kyc-e2e';
import { createListing, publishedBusiness } from './support/listings-e2e';

/** Kind no other suite publishes, so the reference price is only what this test builds. */
const pack = (price: number) => ({
  offerKind: 'SERVICE_PACK',
  name: `Paquete ${letters(6)}`,
  description: 'Sesiones de fisioterapia.',
  price,
  sessionsCount: 8,
});

describe('reference price of the outlier check (e2e, franja 8c)', () => {
  let h: KycHarness;

  beforeAll(async () => {
    h = await bootKycHarness();
  }, 60000);

  afterAll(async () => {
    await h.close();
  });

  it('one value per seller, never the seller being checked, and only with five distinct other sellers', async () => {
    const sellers: KycBusiness[] = [];
    const seller = async (label: string) => {
      const owner = await publishedBusiness(h, label);
      sellers.push(owner);
      return owner;
    };
    try {
      // One seller floods the kind with cheap listings: still a single, excluded voice.
      const flooder = await seller('lst-flood');
      for (let index = 0; index < 6; index += 1) expect((await createListing(h, flooder, pack(10))).moderationStatus).toBe('LIVE');
      const honest = await seller('lst-honest');
      expect(await createListing(h, honest, pack(300))).toMatchObject({ moderationStatus: 'LIVE', autoCheckCodes: [] });
      // Its own cheap listings never make the flooder's dearer one an outlier.
      expect((await createListing(h, flooder, pack(300))).moderationStatus).toBe('LIVE');

      // Four more sellers at 10: with five distinct others (median 10) a price of 300 is held.
      for (const label of ['lst-ref-a', 'lst-ref-b', 'lst-ref-c', 'lst-ref-d']) await createListing(h, await seller(label), pack(10));
      const late = await seller('lst-late');
      expect(await createListing(h, late, pack(300))).toMatchObject({ moderationStatus: 'HELD', autoCheckCodes: ['PRICE_OUTLIER'] });
    } finally {
      // Out of the public sample for later runs of this database.
      await h.e2e.sql(`UPDATE directory.entity_plans SET status = 'ARCHIVED' WHERE entity_id IN (:ids)`, { ids: sellers.map((owner) => owner.entityId) });
    }
  }, 120000);
});
