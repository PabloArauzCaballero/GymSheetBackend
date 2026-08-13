# Matriz fase-de-la-skill → realidad del repo

Estados: **DONE** (ya cubierto con evidencia) · **PARTIAL** (existe base, falta ajuste
acotado) · **BLOCKED** (requiere un input externo que no puede inventarse) · **N/A** (no aplica
al dominio real de este repo).

| # | Fase de la skill | Estado | Evidencia / motivo | Acción propuesta |
|---|---|---|---|---|
| 0 | Leer reglas + proteger workspace | DONE | `CLAUDE.md`, `.claude/rules/*`, `git status` leídos; working tree con trabajo de outbox sin commitear que **no** se toca. | — |
| 1 | Auditoría backend/DB/seeds/assets | DONE | Este documento + `README.md`. Inventario con rutas y líneas. | — |
| 2 | Resolver GitHub canónico y fijar versión | PARTIAL | No hay repo de datos aparte; sí datasets de ejercicios. Se fija por `contentSha256`/ETag, no por commit SHA de Git. | **A3:** registrar además el commit SHA del repo externo en la sync-state. |
| 3 | Snapshot local inmutable de la fuente | PARTIAL | La sync-state guarda sha + versión + conteo, pero no un `raw/` inmutable versionado. | **A4:** opción de volcar snapshot a `artifacts/data-reform/` (solo si se adopta modo `github` en boot). |
| 4 | Analizar reforma de esquema (target) | **N/A** | Decisión del propietario (2026-08-12): **no hay reforma de esquema**; el esquema se conserva. Ver [ADR-0008](../decisions/ADR-0008-schema-reform-intake.md) (cerrado). | — |
| 5 | Diseñar/aplicar migraciones | BLOCKED | Depende de la fase 4. El mecanismo de migraciones existe y es sólido (una tx por migración, `down`, registry ordenado). | Al desbloquear fase 4. |
| 6 | Mappers y reglas de transformación | PARTIAL | Existen mappers de dominio y el mapeo `toExerciseAttributes` del importador. Un mapeo old→target depende de la reforma. | Al desbloquear fase 4. |
| 7 | Transformar y validar datos | DONE (ejercicios) | Pipeline Zod `.strict()`, allowlist SSRF, cap de bytes, `MIN_RECORDS`, dedupe por id. | — |
| 8 | Migrar imágenes a un proveedor de media | **DONE (infra) / BLOCKED (Cloudinary)** | Implementada arquitectura de **puertos y adaptadores** + **adaptador local Multer** (idempotente por sha256), factory sin fallback silencioso, endpoint admin, persistencia en `media.files` sin migración. Cloudinary/S3 = adaptadores pendientes de credenciales. Ver [ADR-0007](../decisions/ADR-0007-pluggable-media-storage.md). | Añadir `CloudinaryAdapter`/`S3Adapter` cuando lleguen credenciales. |
| 9 | Reconciliar dataset completo | DONE (ejercicios) | `findOrCreate` por clave natural + `deactivateMissingExercises` (soft-delete) + checkpoint. | — |
| 10 | Generar boot seeders definitivos e idempotentes | DONE | `seed.ts` + `customer-experience.seed.ts`: upsert por clave natural, lock advisory, campos gestionados. Evidencia: `unchanged=9` en 2ª corrida. | — |
| 11 | Selector de fuente `github \| seeders` por ENV | **DONE (opción b)** | `CANONICAL_EXERCISES_SOURCE` validada fail-fast (github exige dataset habilitado, sin fallback silencioso); `bootstrapCanonicalExercises()` anuncia la fuente en el arranque. Persistencia del snapshot local = paso mecánico documentado. Ver [ADR-0006](../decisions/ADR-0006-bootstrap-data-source-selector.md). | Versionar snapshot real + wiring del loader. |
| 12 | Idempotencia y concurrencia de startup | DONE | Locks advisory separados para migraciones y seeds; upserts idempotentes; import con change-skip por sha. | **A5 (menor):** ledger unificado de bootstrap (hoy hay `schema_migrations` + `exercise_dataset_sync_state`). |
| 13 | Orden de arranque | DONE | `validate env → migrations → seeds`; readiness verifica migraciones pendientes (503). | — |
| 14 | Plan de rollback y protección de datos | PARTIAL | Migraciones con `down`; CI ejercita migrate/rollback/backup (según audit doc). Falta plan específico de reforma. | Al desbloquear fase 4; ver [safety notes](./bootstrap-source-selector-design.md#seguridad-y-rollback). |
| 15 | Pruebas base vacía + existente + 2ª corrida | PARTIAL | Existen specs de seeds e importador; falta harness explícito de "2ª corrida" para el modo `github` en boot. | Al adoptar ADR-0006. |
| 16 | Comparar paridad GitHub vs Seeders | BLOCKED→PARTIAL | Solo tiene sentido si se adopta el selector (ADR-0006). Hoy no hay dos fuentes para los mismos registros. | Al adoptar ADR-0006. |
| 17 | Plan de reforma del frontend | BLOCKED | Depende de un cambio de contrato, que depende de las fases 4/8. Sin cambio de contrato no hay reforma de frontend que planear. | Al desbloquear fases 4/8. |
| 18 | Auditoría final + progress report | DONE (de esta corrida) | [`../progress/data-reform-progress-report.md`](../progress/data-reform-progress-report.md). | — |

## Acciones menores seguras (no bloqueadas) — candidatas a implementar

Estas **no** requieren inputs externos y son de bajo riesgo, pero **tocan comportamiento** y por
tanto se dejan como propuesta explícita (regla 00: preservar comportamiento; no sobre-abstraer,
regla 20). No se aplicaron en esta corrida para no mezclarlas con el trabajo de outbox sin commitear
en el working tree.

- **A3** — Persistir el commit SHA del repo externo (además del `contentSha256`) en
  `exercise_dataset_sync_state`, para trazabilidad de procedencia exacta.
- **A5** — Unificar un pequeño *bootstrap ledger* (`app_meta.bootstrap_runs`) que registre
  `source_type`, `dataset_fingerprint`, conteos y estado por arranque. Complementa, no reemplaza,
  `schema_migrations` y `exercise_dataset_sync_state`.

Recomendación: aplicarlas en su **propia rama** (`feat/data-reform-provenance`) después de commitear
o descartar el trabajo de outbox actual, para mantener diffs revisables.
