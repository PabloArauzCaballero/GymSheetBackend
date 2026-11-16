import { HttpStatus } from '@nestjs/common';
import { Transaction } from 'sequelize';
import { DomainException } from '../../common/errors/domain.exception';
import { DirectoryEntityType } from '../directory/directory-entity.model';
import { normalizeSearchText } from '../exercises/exercise-search';
import { BusinessAccountsRepository } from './business-accounts.repository';
import { handleSkeleton, isReservedSkeleton } from './handle-rules';

export type BusinessNameRejection = 'INVALID' | 'RESERVED' | 'TOO_SIMILAR';

/** A letter outside the Latin script: Cyrillic `і` or Greek `ο` would dodge the skeleton. */
const NON_LATIN_LETTER = /(?=\p{L})\P{Script=Latin}/u;

/**
 * Anti-impersonation key of a commercial name, folded like a handle. The same
 * fold runs in SQL as `directory.business_name_skeleton` (migration
 * 202611200402) for the comparison against other listings.
 */
export function businessNameSkeleton(name: string): string {
  return handleSkeleton(normalizeSearchText(name).replace(/ /gu, ''));
}

/** The checks that need no database: script and reserved words. Expects the NFKC form. */
export function rejectBusinessName(name: string): BusinessNameRejection | null {
  if (NON_LATIN_LETTER.test(name)) return 'INVALID';
  return isReservedSkeleton(businessNameSkeleton(name)) ? 'RESERVED' : null;
}

const ERRORS: Record<BusinessNameRejection, () => DomainException> = {
  INVALID: () =>
    new DomainException(HttpStatus.UNPROCESSABLE_ENTITY, 'BUSINESS_NAME_INVALID', 'Escribe el nombre con letras latinas, números y signos.'),
  RESERVED: () => new DomainException(HttpStatus.UNPROCESSABLE_ENTITY, 'BUSINESS_NAME_RESERVED', 'Ese nombre está reservado.'),
  TOO_SIMILAR: () =>
    new DomainException(
      HttpStatus.UNPROCESSABLE_ENTITY,
      'BUSINESS_NAME_TOO_SIMILAR',
      'Se parece demasiado al nombre de otro negocio. Prueba con otro.',
    ),
};

/**
 * The commercial name is material (ADR-0020): the same reserved-word and
 * look-alike checks as a handle, against REPP's protected brands and the
 * public listings of the same type. `exceptEntityId` is the listing itself.
 */
export async function assertBusinessNameAllowed(
  accounts: BusinessAccountsRepository,
  name: string,
  entityType: DirectoryEntityType,
  exceptEntityId: string | null,
  transaction?: Transaction,
): Promise<void> {
  const rejection = rejectBusinessName(name) ?? (await accounts.findNameHolder(name, entityType, exceptEntityId, transaction));
  if (rejection) throw ERRORS[rejection]();
}
