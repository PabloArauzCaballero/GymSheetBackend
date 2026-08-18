# Data reform — evidencia, alcance y decisiones pendientes

> Documento generado por la ejecución de la skill externa
> `github-canonical-data-reform` sobre GymSheet Backend.
> **Fecha:** 2026-08-07 · **Rama:** `fix/membership-seed-and-lock` ·
> **Commit base:** `27f3fd2` (working tree con trabajo de outbox/messaging sin commitear).

## 0. Resumen ejecutivo

La skill solicitada asume un flujo genérico: un **repositorio GitHub externo canónico** de
registros, una **reforma de esquema entregada por el usuario**, y una **migración de imágenes a
Cloudinary**, con un selector de arranque `github | seeders`.

Auditado el repositorio con evidencia (ver §2 y §3), el resultado es análogo al precedente ya
registrado y **acordado con el propietario** en
[`BACKEND_AUDIT_HARDENING_AND_ACTION_PLAN.md` §0](../../BACKEND_AUDIT_HARDENING_AND_ACTION_PLAN.md):
la parte del encargo que corresponde al dominio real se aplica; la parte que describe un sistema que
este repositorio **no es** se declara *No aplicable* con evidencia, **sin fabricar datos, esquemas ni
dependencias** (regla [00-governance](../../.claude/rules/00-governance.md), regla
[70-library-selection](../../.claude/rules/70-library-selection.md)).

Hallazgo central: **gran parte del flujo de la skill ya existe y está bien implementado** para el
único dominio del repo donde aplica (el catálogo de ejercicios, que ya se nutre de GitHub como fuente
canónica). Los tres elementos que la skill da por entregados **no existen ni pueden inventarse sin
corromper el proyecto o violar las reglas**:

| Prerrequisito de la skill | Estado en el repo | Resolución |
|---|---|---|
| Repositorio GitHub externo canónico de registros | **Parcial.** No hay un repo de datos aparte; sí hay datasets GitHub canónicos ya integrados para ejercicios. | Aplicar al dominio de ejercicios; documentar. |
| Reforma de esquema objetivo entregada por el usuario | **Ausente.** Ningún documento de reforma. | Bloqueado. No se inventa. Ver [ADR-0008](../decisions/ADR-0008-schema-reform-intake.md). |
| Cuenta/credenciales Cloudinary + uso de imágenes propias | **Ausente.** Cero referencias a Cloudinary; media por URL externa. | Bloqueado. Requiere ADR + secretos. Ver [ADR-0007](../decisions/ADR-0007-pluggable-media-storage.md). |

## 1. Qué se entrega en esta corrida (seguro, reversible, sin fabricar)

1. Este inventario con evidencia (rutas + líneas).
2. [`gap-matrix.md`](./gap-matrix.md): matriz **fase de la skill → realidad del repo → estado →
   acción**, las 18 fases.
3. [`bootstrap-source-selector-design.md`](./bootstrap-source-selector-design.md): diseño del
   selector `github | seeders` armonizado con el bootstrap y el importador ya existentes.
4. [`media-storage-assessment.md`](./media-storage-assessment.md): evaluación del punto de anclaje de
   almacenamiento de media (Cloudinary u otro) sobre `MediaFileModel.storageUrl` / `public_id`.
5. Tres ADR en estado **Proposed** para las decisiones que requieren tu aprobación:
   [ADR-0006](../decisions/ADR-0006-bootstrap-data-source-selector.md) (selector),
   [ADR-0007](../decisions/ADR-0007-pluggable-media-storage.md) (media storage),
   [ADR-0008](../decisions/ADR-0008-schema-reform-intake.md) (intake de reforma de esquema).
6. [`../progress/data-reform-progress-report.md`](../progress/data-reform-progress-report.md).

**No se modificó código de producción** en esta corrida: cada cambio de comportamiento que la skill
pediría depende de una de las tres decisiones bloqueadas, y las reglas del repo prohíben inventarlas
o añadir dependencias sin ADR. Los ADR dejan cada cambio listo para aplicarse en minutos tras tu
aprobación.

## 2. Fuente de verdad — fuentes canónicas reales (evidencia)

No existe un repositorio de datos GitHub aparte; el único remoto es el propio proyecto
(`origin → github.com/PabloArauzCaballero/GymSheetBackend`). Sí existen **dos datasets GitHub tratados
como canónicos** para el catálogo de ejercicios, configurados en
[`src/config/env.ts`](../../src/config/env.ts):

| Rol | Variable | Valor por defecto |
|---|---|---|
| Dataset principal de ejercicios | `EXERCISES_DATASET_JSON_URL` | `raw.githubusercontent.com/hasaneyldrm/exercises-dataset/main/data/exercises.json` |
| Catálogo de media abierta | `EXERCISES_OPEN_MEDIA_JSON_URL` | `raw.githubusercontent.com/yuhonas/free-exercise-db/main/dist/exercises.json` |
| Base de media abierta | `EXERCISES_OPEN_MEDIA_BASE_URL` | `raw.githubusercontent.com/yuhonas/free-exercise-db/main/exercises/` |

**Fijación de versión:** el importador ya calcula un `contentSha256` sobre el texto crudo y deriva
`sourceVersion` del ETag (o del sha), y lo persiste en `integration.exercise_dataset_sync_state`
(clave `source_key = "hasaneyldrm/exercises-dataset"`). Es decir, el requisito de la skill de "fijar
el SHA y no usar «latest» a ciegas" **ya está satisfecho por contenido** (sha256), aunque no se fija
un commit SHA de Git del repo externo. Ver acción A3 en la matriz.

Reproducción de la extracción: `yarn db:sync:workoutkata` (one-shot) o el worker
`worker:exercises-dataset`. Requiere `EXERCISES_DATASET_ENABLED=true`.

## 3. Inventario de datos de arranque (evidencia)

### 3.1 Bootstrap de arranque
[`src/main.ts:13`](../../src/main.ts) llama `await bootstrapDatabase()` **antes** de crear la app.
[`src/database/database-bootstrap.ts`](../../src/database/database-bootstrap.ts) ejecuta, en orden:
`runMigrations('up')` → `runSeeds(startupSeedMode())`, donde `startupSeedMode()` devuelve `all` en
`development` y `base` en el resto. **Los seeds corren automáticamente en el arranque.**

- Migraciones: lock advisory `pg_advisory_lock(hashtext('gym_sheet_backend_database_migrations'))`,
  `ensureBaseSchema` (aplica `docs/db/schema.sql`), `schema_migrations` en `app_meta`, una transacción
  por migración. Readiness (`GET /ready`) devuelve 503 si hay migraciones pendientes en el build.
- Seeds: lock advisory transaccional `...('gym_sheet_backend_database_seeds')`, upsert idempotente por
  clave natural (email) para usuarios, `seedCustomerExperience` para features/planes/media/escenarios.
  Mock prohibido en `production`. Evidencia previa de idempotencia: dos corridas consecutivas →
  `created=0, updated=0, unchanged=9` ([`docs/dev-membership-seeds.md`](../dev-membership-seeds.md)).

### 3.2 Clasificación de datos (según taxonomía de la skill)
| Conjunto | Clasificación skill | Ubicación |
|---|---|---|
| Admin (email/hash) | BOOT/CANONICAL | `seed.ts` (`SEED_ADMIN_*`) |
| Features / planes DEV | BOOT + MOCK (marcados `· Desarrollo`, `developmentOnly`) | `customer-experience.seed.ts` |
| Usuarios/escenarios mock | MOCK/DEV (prohibido en prod) | `customer-experience.seed.ts` |
| Catálogo de ejercicios | CANONICAL (fuente GitHub externa) | `src/modules/exercises/import/` |
| Media de planes (Unsplash) | EXTERNAL URL (no controlada) | `customer-experience.seed.ts` |

### 3.3 Media
[`src/modules/membership/media-file.model.ts`](../../src/modules/membership/media-file.model.ts):
tabla `media.files`, con `storageUrl` **nullable** (hoy siempre `null`), `publicId` (UUID) ya
presente, y sin columna `provider`. El mapper de membresía ya lee `storageUrl ?? sourceUrl`
([`membership.mapper.ts:30`](../../src/modules/membership/membership.mapper.ts)). La media de
ejercicios vive en `ExerciseMediaModel` (`training.exercise_media`) con enum `provider` (hoy solo
`EXTERNAL_URL`). **No hay `secure_url` ni ningún upload de binarios a un proveedor.**
