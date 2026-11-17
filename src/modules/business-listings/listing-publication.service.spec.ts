import { EntityPlanModel } from '../directory/models/entity-plan.model';
import { BusinessListingsRepository } from './business-listings.repository';
import { ListingPublicationService } from './listing-publication.service';

function build(options: { median?: number | null; banned?: boolean } = {}) {
  const repository = {
    priceMedian: jest.fn().mockResolvedValue(options.median ?? null),
    containsBannedTerm: jest.fn().mockResolvedValue(options.banned ?? false),
  };
  return { service: new ListingPublicationService(repository as unknown as BusinessListingsRepository), repository };
}

const candidate = { entityId: 'entity-1', offerKind: 'PRODUCT' as const, name: 'Mancuernas', description: 'Par de 10 kg', benefits: [], price: 300 };
const existing = (patch: Partial<EntityPlanModel>) =>
  ({ moderationStatus: 'LIVE', moderationReasonCode: null, autoCheckCodes: [], publishedAt: new Date('2026-11-01T00:00:00Z'), ...patch }) as EntityPlanModel;
const tx = {} as never;

describe('ListingPublicationService (post-moderation, ADR-0022)', () => {
  it('a new listing that passes is LIVE at once, with its publish time', async () => {
    const outcome = await build().service.evaluate(candidate, null, { text: true, price: true }, tx);
    expect(outcome).toMatchObject({ moderationStatus: 'LIVE', autoCheckCodes: [], moderationReasonCode: null });
    expect(outcome.publishedAt).toBeInstanceOf(Date);
  });

  it('a banned term or a price out of the band holds it, with every code for the seller', async () => {
    const outcome = await build({ banned: true }).service.evaluate({ ...candidate, price: 0 }, null, { text: true, price: true }, tx);
    expect(outcome).toEqual({ moderationStatus: 'HELD', moderationReasonCode: 'PRICE_OUT_OF_BAND', autoCheckCodes: ['PRICE_OUT_OF_BAND', 'BANNED_TERMS'], publishedAt: null });
  });

  it('on a LIVE listing a text edit runs only the text check: a released price is not held again', async () => {
    const { service, repository } = build({ median: 10 });
    const outcome = await service.evaluate(candidate, existing({}), { text: true, price: false }, tx);
    expect(outcome.moderationStatus).toBe('LIVE');
    expect(repository.priceMedian).not.toHaveBeenCalled();
  });

  it('a HELD listing re-runs everything, so fixing it publishes it', async () => {
    const { service, repository } = build();
    const outcome = await service.evaluate(candidate, existing({ moderationStatus: 'HELD', publishedAt: null, autoCheckCodes: ['BANNED_TERMS'] }), { text: false, price: false }, tx);
    expect(repository.containsBannedTerm).toHaveBeenCalled();
    expect(outcome).toMatchObject({ moderationStatus: 'LIVE', autoCheckCodes: [] });
  });

  it('a listing REPP hid stays hidden, keeps REPP\'s reason and still records what the checks found', async () => {
    const outcome = await build({ banned: true }).service.evaluate(candidate, existing({ moderationStatus: 'HIDDEN', moderationReasonCode: 'SPAM' }), { text: true, price: true }, tx);
    expect(outcome).toMatchObject({ moderationStatus: 'HIDDEN', moderationReasonCode: 'SPAM', autoCheckCodes: ['BANNED_TERMS'] });
  });

  it('the reference price never counts the seller being checked', async () => {
    const { service, repository } = build();
    await service.evaluate(candidate, null, { text: true, price: true }, tx);
    expect(repository.priceMedian).toHaveBeenCalledWith('PRODUCT', 'entity-1', expect.any(Number), tx);
  });
});
