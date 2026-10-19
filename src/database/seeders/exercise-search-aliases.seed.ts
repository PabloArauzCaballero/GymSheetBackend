import { QueryTypes, Transaction } from "sequelize";
import { Sequelize } from "sequelize-typescript";
import { EXERCISE_NAMES_ES_CATALOG } from "./showcase/exercise-names-es.catalog";

/**
 * Alias de búsqueda del catálogo de ejercicios.
 *
 * El catálogo viene en inglés y solo una parte tiene `nombre_es` revisado. El
 * resto tiene una traducción en borrador que NO se enseña hasta que una persona
 * la revise, pero sí debe servir para encontrar el ejercicio: quien teclea
 * «curl martillo» espera resultados aunque ese nombre aún no esté publicado.
 * Aquí se copia el nombre en español de todo el catálogo (revisado o no) a
 * `ejercicios.alias_busqueda`, que solo usa el buscador.
 *
 * Idempotente: solo escribe las filas cuyo alias cambió. Si la columna aún no
 * existe (base sin la migración 202610130002) no hace nada.
 */
export async function seedExerciseSearchAliases(
  sequelize: Sequelize,
  transaction: Transaction,
): Promise<{ searchAliasesUpdated: number }> {
  const [column] = await sequelize.query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'ejercicios' AND column_name = 'alias_busqueda'
     ) AS "exists"`,
    { type: QueryTypes.SELECT, transaction },
  );
  if (!column?.exists) return { searchAliasesUpdated: 0 };

  const entries = Object.entries(EXERCISE_NAMES_ES_CATALOG).filter(([, names]) => names.es.trim());
  if (entries.length === 0) return { searchAliasesUpdated: 0 };

  const [, affected] = await sequelize.query(
    `UPDATE public.ejercicios e
        SET alias_busqueda = a.alias
       FROM (SELECT unnest(ARRAY[:externalIds]::text[]) AS external_id,
                    unnest(ARRAY[:aliases]::text[]) AS alias) a
      WHERE e.external_id = a.external_id
        AND e.tipo_ejercicio = 'GLOBAL'
        AND e.data_source = 'EXERCISES_DATASET'
        AND e.alias_busqueda IS DISTINCT FROM a.alias`,
    {
      type: QueryTypes.UPDATE,
      replacements: {
        externalIds: entries.map(([externalId]) => externalId),
        aliases: entries.map(([, names]) => names.es.trim()),
      },
      transaction,
    },
  );
  return { searchAliasesUpdated: Number(affected ?? 0) };
}
