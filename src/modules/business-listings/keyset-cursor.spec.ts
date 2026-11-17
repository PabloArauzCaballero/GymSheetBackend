import { decodeKeyset, decodePriceKeyset, encodeCursor } from './keyset-cursor';

const id = '0b6c1d2e-3f40-4a51-8b62-7c83d94ea5f6';

describe('keyset cursors', () => {
  it('round-trips a timestamp (microseconds kept as text) and a price', () => {
    expect(decodeKeyset(encodeCursor('2026-11-16T10:00:00.123Z', id))).toEqual({ key: '2026-11-16T10:00:00.123Z', id });
    expect(decodeKeyset(encodeCursor('2026-11-16T10:00:00.123456Z', id))?.key).toBe('2026-11-16T10:00:00.123456Z');
    expect(decodePriceKeyset(encodeCursor('199.90', id))).toEqual({ price: '199.90', id });
    expect(decodeKeyset(undefined)).toBeNull();
  });

  it('a tampered cursor is a 400 INVALID_CURSOR, never SQL', () => {
    for (const cursor of [
      'not-base64-at-all',
      encodeCursor('2026-11-16T10:00:00Z', 'nope'),
      encodeCursor("2026-11-16'; DROP TABLE x;--", id),
      Buffer.from(`2026-11-16T10:00:00Z|${id}|extra`).toString('base64url'),
    ]) {
      expect(() => decodeKeyset(cursor)).toThrow(expect.objectContaining({ code: 'INVALID_CURSOR' }));
    }
    expect(() => decodePriceKeyset(encodeCursor('1e9', id))).toThrow(expect.objectContaining({ code: 'INVALID_CURSOR' }));
    expect(() => decodePriceKeyset(encodeCursor('-1', id))).toThrow(expect.objectContaining({ code: 'INVALID_CURSOR' }));
  });
});
