# Diseño — selector de fuente de arranque `github | seeders`

> Estado: **diseño para [ADR-0006](../decisions/ADR-0006-bootstrap-data-source-selector.md)**.
> No implementado. Armoniza con el bootstrap y el importador ya existentes; **no** duplica lógica.

## Problema

Hoy el arranque ([`database-bootstrap.ts`](../../src/database/database-bootstrap.ts)) siempre corre
los seeds locales. El import canónico desde GitHub (ejercicios) vive en un worker/CLI aparte
(`worker:exercises-dataset`, `db:sync:workoutkata`). La skill pide poder **elegir por ENV** la fuente
de datos canónicos administrados que se aplica en el arranque, con un **único pipeline canónico** y
**sin fallback silencioso** entre fuentes.

## Alcance correcto para este repo

El selector aplica **solo a datos canónicos administrados por el sistema**, es decir el **catálogo de
ejercicios** (única entidad que ya tiene fuente GitHub). **No** aplica a:
- usuarios admin/mock ni escenarios de membresía (son BOOT/MOCK locales, no provienen de GitHub);
- datos RUNTIME/USER-MANAGED (nunca se tocan).

Esto evita inventar una "fuente github" para entidades que no la tienen.

## Diseño propuesto (mínimo, reutilizando lo existente)

Nueva variable en [`env.ts`](../../src/config/env.ts):

```
CANONICAL_EXERCISES_SOURCE = seeders | github   # default: seeders
```

- Se prefiere `CANONICAL_EXERCISES_SOURCE` sobre un nombre genérico `BOOTSTRAP_DATA_SOURCE` porque el
  selector solo gobierna el catálogo de ejercicios; un nombre genérico prometería más de lo que hace.
- Validación fail-fast (regla de la skill §15.4): valor inválido → la app no arranca. Modo `github`
  exige `EXERCISES_DATASET_ENABLED=true`; si falta, **error explícito, no fallback a `seeders`**.

Flujo en `bootstrapDatabase()`:

```
validate env → runMigrations('up') → runSeeds(startupSeedMode())
             → if CANONICAL_EXERCISES_SOURCE === 'github':
                   ExercisesDatasetService.importDataset({ dryRun:false, importMedia:false })
               else:
                   (opcional) aplicar un boot seed local de ejercicios desde snapshot versionado
```

- Modo `github`: **ya existe** todo (fetch SSRF+Zod, upsert idempotente, change-skip por sha,
  soft-delete, checkpoint). Solo se invoca dentro del boot bajo el mismo lock de arranque.
- Modo `seeders`: requeriría un snapshot local versionado de ejercicios en `database/seeds/boot/` +
  un runner que use el **mismo** `ExercisesDatasetRepository` (mismo contrato canónico interno). Es la
  única pieza nueva de datos; su origen sería un snapshot real del dataset, no datos inventados.

## Idempotencia / concurrencia

El import en boot debe correr bajo un lock advisory de arranque (existe patrón:
`gym_sheet_backend_database_seeds`). El change-skip por `contentSha256` ya evita reprocesar sin
cambios y el upsert por clave natural garantiza cero duplicados en 2ª corrida.

## Paridad (fase 16 de la skill)

Con ambos modos apuntando al mismo `ExercisesDatasetRepository`, un test de paridad puede afirmar que
`github` y `seeders` convergen al mismo estado canónico (mismos `externalId`, conteos, status).

## Seguridad y rollback

- Sin fallback silencioso entre fuentes (regla de la skill; falla ruidosamente).
- El import en boot alarga el arranque y depende de la red en modo `github`: por eso el **default es
  `seeders`** y el modo `github` en boot debe considerarse solo si readiness tolera el tiempo extra.
  Alternativa más segura: mantener el import en el worker y que el selector solo elija el **origen del
  seed local** (snapshot vs vacío). El ADR-0006 debe decidir entre "import en boot" vs "worker + seed".
- Rollback: el soft-delete (`status=INACTIVE`) del importador ya es no destructivo; no hay `DROP`.
