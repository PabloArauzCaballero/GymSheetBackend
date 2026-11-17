import { BusinessAccountsRepository } from './business-accounts.repository';
import { businessProfilePatchSchema } from './business-accounts.schemas';
import { assertBusinessNameAllowed, rejectBusinessName } from './business-name';
import { businessNameSkeleton } from './handle-rules';

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
    expect(rejectBusinessName('Gimnasio Ñandú 24 h')).toBeNull();
    expect(rejectBusinessName('Gimnasio 24/7')).toBeNull();
    // The slash is a separator: it cannot make a look-alike pass as a new name.
    expect(businessNameSkeleton('Top/Fitness')).toBe(businessNameSkeleton('TopFitness'));
    expect(rejectBusinessName('Top Fit Center')).toBeNull();
  });

  // Allowlist: before, anything that was not a letter was deleted from the skeleton, so
  // `T٥p Fit` (Arabic-Indic five) folded to `tpflt` and dodged `Top Fit`.
  it.each([
    ['Top Fіt', 'Cyrillic і'],
    ['Тop Fit', 'Cyrillic Т'],
    ['Τop Fit', 'Greek Τ'],
    ['Top Fιt', 'Greek ι'],
    ['T٥p Fit', 'Arabic-Indic digit'],
    ['T٠p Fit', 'Arabic-Indic zero'],
    ['Top ★ Fit', 'symbol'],
    ['Top Fit 💪', 'emoji'],
    ['Top\u200bFit', 'zero-width space'],
    ['Top Fi\u0338t', 'combining overlay'],
    ['Søren Gym', 'letter that is not a-z with accents'],
    ['- . -', 'no letter or digit'],
  ])('refuses %j (%s) with BUSINESS_NAME_INVALID', (name) => {
    expect(rejectBusinessName(name)).toBe('INVALID');
  });

  it.each([
    ['Top Fit', 'TOP FIT'],
    ['Top Fit', 'Tóp Fít'],
    ['Top Fit', 'T0p F1t'],
    ['Top Fit', "Top-'Fit'"],
    ['Top Fit', 'Top·Fit'],
    ['Mundo Fuerte', 'Rnundo Fuerte'],
    ['Mundo Fuerte', 'RNUNDO-FUERTE'],
    ['Wild Box', 'Vvild Box'],
    ['Peña Sur', 'Pena Sur'],
    ['Gym Vida 5', 'Gym Vida S'],
    ['Club 3', 'Club E'],
  ])('%j and %j share the skeleton', (original, lookAlike) => {
    expect(rejectBusinessName(lookAlike.normalize('NFKC'))).not.toBe('INVALID');
    expect(businessNameSkeleton(lookAlike)).toBe(businessNameSkeleton(original));
  });

  it('keeps different names apart', () => {
    expect(businessNameSkeleton('Mundo Fuerte')).not.toBe(businessNameSkeleton('Nundo Fuerte'));
    expect(businessNameSkeleton('Gym 24')).not.toBe(businessNameSkeleton('Gym 42'));
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
      // The stored-skeleton lookup receives the application fold, never the raw name.
      expect(similar.findNameHolder).toHaveBeenCalledWith('topflt', 'GYM', 'entity-1', undefined);
    });

    it('lets a free name through', async () => {
      await expect(assertBusinessNameAllowed(accounts(null).repository, 'Top Fit Center', 'GYM', null)).resolves.toBeUndefined();
    });
  });
});
