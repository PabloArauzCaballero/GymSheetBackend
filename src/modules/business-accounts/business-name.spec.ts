import { BusinessAccountsRepository } from './business-accounts.repository';
import { businessProfilePatchSchema } from './business-accounts.schemas';
import { assertBusinessNameAllowed, businessNameSkeleton, rejectBusinessName } from './business-name';

describe('business name rules (ADR-0020)', () => {
  it('folds case, accents, separators and look-alikes like a handle', () => {
    const skeleton = businessNameSkeleton('Top Fit Center');
    expect(businessNameSkeleton('TOP-FIT center')).toBe(skeleton);
    expect(businessNameSkeleton('T0p F1t Cénter')).toBe(skeleton);
    expect(businessNameSkeleton('top.fit_center')).toBe(skeleton);
  });

  it('refuses reserved words and the platform name anywhere, as handles do', () => {
    expect(rejectBusinessName('Gimnasio')).toBe('RESERVED');
    expect(rejectBusinessName('ADM1N')).toBe('RESERVED');
    expect(rejectBusinessName('Soporte  REPP')).toBe('RESERVED');
    expect(rejectBusinessName('Repp Fitness Oficial')).toBe('RESERVED');
  });

  it('refuses letters outside the Latin script (homoglyphs dodge the skeleton)', () => {
    expect(rejectBusinessName('Top Fіt')).toBe('INVALID'); // Cyrillic "і"
    expect(rejectBusinessName('Τop Fit')).toBe('INVALID'); // Greek "Τ"
  });

  it('accepts an ordinary commercial name with accents, digits and signs', () => {
    expect(rejectBusinessName('Gimnasio Ñandú 24/7')).toBeNull();
    expect(rejectBusinessName('Top Fit Center')).toBeNull();
  });

  it('folds full-width and compatibility forms before any check', () => {
    const parsed = businessProfilePatchSchema.parse({ name: ' ＲＥＰＰ Gym ' });
    expect(parsed.name).toBe('REPP Gym');
    expect(rejectBusinessName(parsed.name ?? '')).toBe('RESERVED');
  });

  describe('assertBusinessNameAllowed', () => {
    const accounts = (holder: 'RESERVED' | 'TOO_SIMILAR' | null) => {
      const findNameHolder = jest.fn().mockResolvedValue(holder);
      return { repository: { findNameHolder } as unknown as BusinessAccountsRepository, findNameHolder };
    };

    it('does not reach the database for a name refused by the rules', async () => {
      const { repository, findNameHolder } = accounts(null);
      await expect(assertBusinessNameAllowed(repository, 'Admin', 'GYM', 'entity-1')).rejects.toMatchObject({ code: 'BUSINESS_NAME_RESERVED' });
      expect(findNameHolder).not.toHaveBeenCalled();
    });

    it('refuses a REPP-protected brand and a public listing of the same type with the same skeleton', async () => {
      await expect(assertBusinessNameAllowed(accounts('RESERVED').repository, 'Nike', 'STORE', null)).rejects.toMatchObject({
        code: 'BUSINESS_NAME_RESERVED',
        status: 422,
      });
      const similar = accounts('TOO_SIMILAR');
      await expect(assertBusinessNameAllowed(similar.repository, 'T0p Fit', 'GYM', 'entity-1')).rejects.toMatchObject({
        code: 'BUSINESS_NAME_TOO_SIMILAR',
        status: 422,
      });
      expect(similar.findNameHolder).toHaveBeenCalledWith('T0p Fit', 'GYM', 'entity-1', undefined);
    });

    it('lets a free name through', async () => {
      await expect(assertBusinessNameAllowed(accounts(null).repository, 'Top Fit Center', 'GYM', null)).resolves.toBeUndefined();
    });
  });
});
