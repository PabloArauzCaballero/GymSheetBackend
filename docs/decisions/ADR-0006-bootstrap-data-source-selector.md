# ADR-0006 — Selector de fuente de datos canónicos de arranque (`github | seeders`)

Estado: **aceptado — opción b** (decisión del propietario, 2026-08-12)  
Fecha: 2026-08-07 · **Aceptado:** 2026-08-12  
Origen: skill externa `github-canonical-data-reform`, fase 11. Diseño detallado en
[`docs/data-reform/bootstrap-source-selector-design.md`](../data-reform/bootstrap-source-selector-design.md).

## Decisión (2026-08-12)

El propietario eligió la **opción b: worker + seed local**. El arranque **no** depende de la red: en
modo `seeders` se aplica un snapshot local; el import desde GitHub permanece en su worker dedicado.
Esto mantiene el readiness rápido y desacoplado. Implementación en curso; ver el diseño enlazado.

## Contexto

La skill pide que el arranque pueda **elegir por ENV** la fuente de los datos canónicos administrados
(`github` vs `seeders`), con un **único pipeline canónico** y **sin fallback silencioso**.

Evidencia del estado actual:
- `bootstrapDatabase()` corre migraciones y luego seeds locales, siempre.
- El catálogo de **ejercicios** ya es la única entidad con fuente GitHub canónica, con un importador
  maduro (SSRF+Zod, upsert idempotente por clave natural, change-skip por `contentSha256`,
  soft-delete, sync-state), que hoy corre en un **worker/CLI aparte**, no en el arranque.
- Usuarios/planes/escenarios son BOOT/MOCK locales, sin fuente GitHub.

## Decisión propuesta

1. El selector gobierna **solo el catálogo de ejercicios**. Variable
   `CANONICAL_EXERCISES_SOURCE = seeders | github` (default `seeders`), validada fail-fast; modo
   `github` exige `EXERCISES_DATASET_ENABLED=true` o **falla** (sin fallback a `seeders`).
2. Ambos modos convergen al mismo estado usando el **mismo `ExercisesDatasetRepository`** (contrato
   canónico interno único). Modo `seeders` usa un snapshot local versionado en
   `database/seeds/boot/` derivado de un dump real del dataset (no datos inventados).
3. Decisión abierta a resolver en la aprobación: **(a)** invocar `importDataset` dentro del boot bajo
   lock advisory, o **(b)** mantener el import en el worker y que el selector solo elija el origen del
   seed local. (b) es más seguro para el tiempo de readiness; (a) es más fiel a la skill.

## Consecuencias

- (+) Reproducibilidad y paridad testeable entre fuentes (fase 16).
- (+) Reutiliza todo lo existente; añade una variable y, a lo sumo, un runner de seed local.
- (−) Opción (a) alarga el arranque y lo acopla a la red; por eso el default es `seeders`.
- Requiere: snapshot local de ejercicios + test de paridad + test de 2ª corrida.

## Alternativas

- **No hacer nada** (mantener import solo en worker): válido; se pierde el selector explícito.
- Nombre genérico `BOOTSTRAP_DATA_SOURCE`: rechazado, prometería gobernar todos los datos cuando solo
  gobierna ejercicios.
