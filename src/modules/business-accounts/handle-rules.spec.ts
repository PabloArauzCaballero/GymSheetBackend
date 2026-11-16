import { addDays, handleSkeleton, normalizeHandle, parseHandle, rejectHandle, renameAllowed } from './handle-rules';

describe('handle rules (ADR-0020)', () => {
  it('normalizes what a person types: trim, leading @, NFKC, lower case', () => {
    expect(normalizeHandle('  @TopFit ')).toBe('topfit');
    // Full-width letters fold to ASCII under NFKC.
    expect(normalizeHandle('ＴＯＰfit')).toBe('topfit');
  });

  it('refuses anything that is not plain ASCII after normalizing', () => {
    expect(normalizeHandle('gimnasiö')).toBeNull();
    expect(normalizeHandle('tоpfit')).toBeNull(); // Cyrillic "о"
    expect(parseHandle('gimnasiö')).toEqual({ rejection: 'INVALID' });
  });

  it.each([
    ['ab', 'too short'],
    ['a'.repeat(31), 'too long'],
    ['.topfit', 'leading separator'],
    ['topfit_', 'trailing separator'],
    ['top..fit', 'double separator'],
    ['top._fit', 'mixed double separator'],
    ['top-fit', 'hyphen'],
    ['top fit', 'space'],
    ['12345678', 'only digits (looks like a NIT or a phone)'],
    ['123.456', 'digits and separators only'],
  ])('rejects %s (%s)', (handle) => {
    expect(rejectHandle(handle)).toBe('INVALID');
  });

  it.each(['topfit', 'top.fit', 'top_fit', 'gym24', 'a1b', 'c'.repeat(30)])('accepts %s', (handle) => {
    expect(rejectHandle(handle)).toBeNull();
  });

  it('folds separators and look-alikes into one skeleton', () => {
    const skeleton = handleSkeleton('topfitness');
    expect(handleSkeleton('top.fitness')).toBe(skeleton);
    expect(handleSkeleton('top_fitness')).toBe(skeleton);
    expect(handleSkeleton('t0pfitness')).toBe(skeleton);
    expect(handleSkeleton('topf1tness')).toBe(skeleton);
    expect(handleSkeleton('topfitne55')).toBe(skeleton);
    expect(handleSkeleton('fuerza3')).toBe(handleSkeleton('fuerzae'));
  });

  it('refuses reserved words and their look-alikes', () => {
    expect(rejectHandle('admin')).toBe('RESERVED');
    expect(rejectHandle('adm1n')).toBe('RESERVED');
    expect(rejectHandle('soporte')).toBe('RESERVED');
    expect(rejectHandle('gimnasio')).toBe('RESERVED');
    expect(rejectHandle('m0deracion')).toBe('RESERVED');
  });

  it("refuses the platform's name anywhere in the handle", () => {
    expect(rejectHandle('repp.oficial')).toBe('RESERVED');
    expect(rejectHandle('soy_repp')).toBe('RESERVED');
    expect(rejectHandle('gymrepp')).toBe('RESERVED');
  });

  it('allows one public rename every 30 days and three per year', () => {
    const now = new Date('2026-11-16T12:00:00Z');
    expect(renameAllowed([], now)).toBe(true);
    expect(renameAllowed([addDays(now, -29)], now)).toBe(false);
    expect(renameAllowed([addDays(now, -31)], now)).toBe(true);
    expect(renameAllowed([addDays(now, -40), addDays(now, -100), addDays(now, -200)], now)).toBe(false);
    expect(renameAllowed([addDays(now, -40), addDays(now, -100), addDays(now, -400)], now)).toBe(true);
  });
});
