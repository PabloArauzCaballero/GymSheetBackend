import { HttpStatus } from '@nestjs/common';
import { Transaction } from 'sequelize';
import { DomainException } from '../../common/errors/domain.exception';
import { DirectoryEntityType } from '../directory/directory-entity.model';
import { BusinessAccountsRepository } from './business-accounts.repository';
import { businessNameSkeleton, isReservedSkeleton } from './handle-rules';

export type BusinessNameRejection = 'INVALID' | 'RESERVED' | 'TOO_SIMILAR';

/**
 * Signs a commercial name may carry besides letters and digits. `’` is the
 * apostrophe phone keyboards type; `/` because «24/7» is a common gym name.
 * None of them counts in the skeleton, so they cannot hide a look-alike.
 */
const NAME_SIGNS = new Set([' ', '&', "'", '’', '.', ',', '-', '·', '/']);
const LATIN_LETTER_OR_DIGIT = /^[A-Za-z0-9]$/u;

/**
 * Allowlist, not blocklist: a letter that loses its accents into a-z (`ñ`,
 * `á`, `ü`), an ASCII digit or one of the signs. Cyrillic `і`, Greek `ο`,
 * Arabic-Indic digits or symbols are refused instead of being folded away.
 */
function isAllowedCharacter(character: string): boolean {
  return NAME_SIGNS.has(character) || LATIN_LETTER_OR_DIGIT.test(character.normalize('NFD').replace(/\p{M}/gu, ''));
}

/** The checks that need no database: allowed characters and reserved words. Expects the NFKC form. */
export function rejectBusinessName(name: string): BusinessNameRejection | null {
  if (![...name].every(isAllowedCharacter)) return 'INVALID';
  const skeleton = businessNameSkeleton(name);
  if (skeleton.length < 2) return 'INVALID';
  return isReservedSkeleton(skeleton) ? 'RESERVED' : null;
}

const ERRORS: Record<BusinessNameRejection, () => DomainException> = {
  INVALID: () =>
    new DomainException(HttpStatus.UNPROCESSABLE_ENTITY, 'BUSINESS_NAME_INVALID', "Usa letras (con tildes o ñ), números, espacios y los signos & ' . , - · /"),
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
 * stored skeletons of the public listings of the same type. `exceptEntityId`
 * is the listing itself.
 */
export async function assertBusinessNameAllowed(
  accounts: BusinessAccountsRepository,
  name: string,
  entityType: DirectoryEntityType,
  exceptEntityId: string | null,
  transaction?: Transaction,
): Promise<void> {
  const rejection =
    rejectBusinessName(name) ?? (await accounts.findNameHolder(businessNameSkeleton(name), entityType, exceptEntityId, transaction));
  if (rejection) throw ERRORS[rejection]();
}
