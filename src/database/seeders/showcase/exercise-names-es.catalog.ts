import { EXERCISE_NAMES_ES } from './exercise-names-es.data';
import { EXERCISE_NAMES_ES_BORRADOR } from './exercise-names-es.borrador.data';

/** Entrada del catálogo completo: `revisado` decide si el sembrador la aplica. */
export type CatalogSpanishName = { en: string; es: string; revisado: boolean };

/**
 * Catálogo completo de nombres en español: los 343 revisados a mano (`revisado: true`)
 * más el borrador del resto (`revisado: false` hasta que una persona lo revise).
 */
export const EXERCISE_NAMES_ES_CATALOG: Readonly<Record<string, CatalogSpanishName>> = {
  ...EXERCISE_NAMES_ES_BORRADOR,
  ...Object.fromEntries(Object.entries(EXERCISE_NAMES_ES).map(([id, n]) => [id, { ...n, revisado: true }])),
};

/** Solo lo que una persona ya revisó: es lo único que se escribe en la base. */
export function reviewedSpanishNames(
  catalog: Readonly<Record<string, CatalogSpanishName>> = EXERCISE_NAMES_ES_CATALOG,
): Array<[string, CatalogSpanishName]> {
  return Object.entries(catalog).filter(([, n]) => n.revisado === true);
}
