import { HttpStatus } from '@nestjs/common';
import { DomainException } from '../../common/errors/domain.exception';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?Z$/u;
const PRICE = /^\d{1,9}(\.\d{1,2})?$/u;

/** Opaque keyset cursor: `base64url("<key>|<id>")`. The key is a timestamp or a price. */
export function encodeCursor(key: string, id: string): string {
  return Buffer.from(`${key}|${id}`, 'utf8').toString('base64url');
}

function invalidCursor(): DomainException {
  return new DomainException(HttpStatus.BAD_REQUEST, 'INVALID_CURSOR', 'El cursor no es válido; vuelve a la primera página.');
}

function split(cursor: string): { key: string; id: string } {
  const [key, id, extra] = Buffer.from(cursor, 'base64url').toString('utf8').split('|');
  if (!key || !id || extra !== undefined || !UUID.test(id)) throw invalidCursor();
  return { key, id };
}

/**
 * A timestamp cursor. The key is the database's own text of the instant
 * (microseconds), bound back as text: a JS Date would truncate it to
 * milliseconds and rows created in the same millisecond would repeat page
 * after page. A tampered cursor is a 400, never a silently restarted page.
 */
export function decodeKeyset(cursor: string | undefined): { key: string; id: string } | null {
  if (!cursor) return null;
  const { key, id } = split(cursor);
  if (!ISO_INSTANT.test(key) || Number.isNaN(new Date(key).getTime())) throw invalidCursor();
  return { key, id };
}

/** A price cursor (BOB with up to two decimals), bound as a string so no float drifts. */
export function decodePriceKeyset(cursor: string | undefined): { price: string; id: string } | null {
  if (!cursor) return null;
  const { key, id } = split(cursor);
  if (!PRICE.test(key)) throw invalidCursor();
  return { price: key, id };
}
