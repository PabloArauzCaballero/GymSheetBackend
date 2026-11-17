import { HttpStatus } from '@nestjs/common';
import { DomainException } from '../../common/errors/domain.exception';

/** A position in an order list: the bucket, the numeric sort key as the database printed it, and the id. */
export type OrderKeyset = { bucket: number; sortKey: string; id: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const SORT_KEY = /^-?\d{1,12}(\.\d{1,6})?$/u;

/** Opaque: `base64url("<bucket>|<sortKey>|<id>")`. The key keeps the microseconds the database gave. */
export function encodeOrderCursor(row: { bucket: number; sortKey: string; id: string }): string {
  return Buffer.from(`${row.bucket}|${row.sortKey}|${row.id}`, 'utf8').toString('base64url');
}

/** A tampered cursor is a 400, never a silently restarted page. */
export function decodeOrderCursor(cursor: string | undefined): OrderKeyset | null {
  if (!cursor) return null;
  const [bucket, sortKey, id, extra] = Buffer.from(cursor, 'base64url').toString('utf8').split('|');
  if ((bucket !== '0' && bucket !== '1') || !sortKey || !SORT_KEY.test(sortKey) || !id || !UUID.test(id) || extra !== undefined) {
    throw new DomainException(HttpStatus.BAD_REQUEST, 'INVALID_CURSOR', 'El cursor no es válido; vuelve a la primera página.');
  }
  return { bucket: Number(bucket), sortKey, id };
}
