---
title: "Exercises"
type: domain
status: verified
criticality: medium
last_reviewed: "2026-08-06"
source_revision: "27f3fd2"
domain: "exercises"
source_files: [
  "src/modules/exercises/exercises.controller.ts",
  "src/modules/exercises/exercises.service.ts",
  "src/modules/exercises/exercise-media.service.ts",
  "src/modules/exercises/import/exercises-dataset.service.ts",
  "src/modules/exercises/import/exercises-dataset.client.ts",
  "src/modules/exercises/exercises.schemas.ts"
]
tags: [backend, domain]
related: ["[[03-domains/equipment/index]]", "[[03-domains/training/index]]", "[[08-security/index]]"]
---

# Exercises

## Resumen

Catálogo de ejercicios (globales y personales), su media, favoritos de usuario, y sincronización de un
dataset externo con allowlist anti-SSRF. Fuente de ejercicios para `training` y `workouts`.

## Responsabilidad

- CRUD de ejercicios globales (ADMIN) y personales (dueño), con visibilidad y soft-delete.
- Gestionar media (tope 10 activos, primaria automática).
- Favoritos de usuario.
- Importar un dataset externo de forma idempotente (worker + comando).

## Límites

- No valida equipamiento (consume `equipment`).
- La entrega de media externa no reproduce archivos; solo referencia URLs validadas.

## Entradas

HTTP `/exercises`, `/user-exercises`, `/admin/exercises/*`, Zod. Fetch HTTP del dataset externo.

## Salidas

DTOs vía mappers; upserts en `ejercicios` y `training.exercise_media`; checkpoint en
`integration.exercise_dataset_sync_state`.

## Casos de uso

- Usuario: listar/ver ejercicios visibles, CRUD de personales, favoritos, ver media.
- ADMIN: CRUD global, gestión de media, import manual/estado del dataset.

## Reglas de negocio

- Visibilidad = ACTIVE AND (GLOBAL OR PERSONAL del usuario).
- `validateEquipmentIds` cruza contra `EquipmentRepository.findLinkableIds` (no INACTIVE) → 400 si no
  coincide.
- Media: `MAX_ACTIVE_MEDIA_PER_EXERCISE = 10` (409); al quitar la primaria, `promoteFirstActive`.
- Import: gated `EXERCISES_DATASET_ENABLED`; media requiere
  `EXERCISES_DATASET_MEDIA_LICENSE_CONFIRMED`; upsert idempotente por `(dataSource, externalId)`;
  `deactivateMissingExercises`; short-circuit por `content_sha256` sin cambios.

## Componentes principales

| Componente | Tipo | Responsabilidad | Evidencia |
|---|---|---|---|
| `ExercisesService` | Service | Visibilidad, CRUD, favoritos, validación de equipo | `exercises.service.ts` |
| `ExerciseMediaService` | Service | Media (tope, primaria) | `exercise-media.service.ts` |
| `ExercisesDatasetService` | Service | Import idempotente por lotes | `import/exercises-dataset.service.ts` |
| `ExercisesDatasetClient` | Client | Fetch acotado + allowlist SSRF | `import/exercises-dataset.client.ts` |

## Entidades y datos

`ExerciseModel` (`ejercicios`; provenance, instructions JSONB), `ExerciseMediaModel`
(`training.exercise_media`), `ExerciseEquipmentModel` (join), `UserExerciseModel` (favoritos).
Detalle: [[05-data/index]].

## Endpoints o contratos

`GET /exercises`, `GET /exercises/:id`, `POST /exercises/personal`, `PATCH|DELETE /exercises/:id`;
admin `/admin/exercises/global` (create/update/inactivate); `/user-exercises` (list/add/remove);
`/exercises/:exerciseId/media` (list/add), `DELETE /exercise-media/:mediaId`; dataset
`admin/exercises/import/exercises-dataset{,/status}` (`@Roles(ADMIN)`). [[04-api/index]].

## Eventos

Ninguno (no usa outbox). El sync usa tabla raw de checkpoint, no el outbox (`INFERIDO` deliberado).

## Dependencias

`EquipmentModule` (`EquipmentRepository`). Modelos referencian `UserModel`. Worker depende de
`config/env` + `ExercisesDatasetService`.

## Autenticación y permisos

Guards globales; ownership en service. Recurso no visible/ajeno → 404
(`findVisibleExerciseModelOrFail`); modificar personal ajeno visible → **403**
(`ForbiddenException`) → `ARCH-2` desviación menor de la regla "preferir 404".

## Manejo de errores

409 (favorito duplicado, tope de media), 400 (equipo inválido), 403 (ownership/media/licencia),
404 (ausente/no visible); el cliente del dataset envuelve fallos como 503 (Zod, timeout, oversize,
content-type).

## Transacciones y consistencia

Create/update transaccional con `replaceExerciseEquipment`. Import por lotes
(`EXERCISES_DATASET_BATCH_SIZE`) con transacción por lote; checkpoint por SQL raw.

## Procesamiento asíncrono

`exercises-dataset-refresh.runner` (loop con delay calculado) + `exercises-dataset-sync.command`
(CLI). Ver [[07-async-processing/workers]].

## Observabilidad

`getRefreshStatus` expone último refresh y próximo. Cliente registra fallos como 503.

## Pruebas

- `exercises.service.spec.ts` — 3 casos de ownership (invisible→404, editar personal ajeno→403,
  endpoint personal sobre global→403).
- `import/exercises-dataset.schemas.spec.ts` — válido, id duplicado, propiedad inesperada.
- (Presentes) `exercises-dataset.client.spec.ts`, `.service.spec.ts`, `.repository.spec.ts`,
  `runner.spec.ts`.

## Riesgos

- `SEC-3` (SSRF) — `validateSourceUrl` exige `https:`, host en `EXERCISES_DATASET_ALLOWED_HOSTS`, sin
  credenciales/puerto, más `redirect:'error'` y allowlist de content-type. Pero `resolveMediaBaseUrl`
  deriva base de media (`new URL("../", sourceUrl)`) sin re-validar allowlist (asimétrico; bajo porque
  hereda el host del dataset).
- Dos caminos de creación de media (repo directo vs dataset) con riesgo de divergencia.

## Referencias al código

- `exercises.service.ts` → `getVisibleExerciseOrFail`, `validateEquipmentIds`.
- `import/exercises-dataset.client.ts` → `validateSourceUrl`, `readBoundedResponse`.
- `import/exercises-dataset.service.ts` → `importDataset`.
- `exercises.schemas.ts` → `createGlobalExerciseSchema`, `createExerciseMediaSchema`.

## Relaciones

[[03-domains/equipment/index]] · [[03-domains/training/index]] · [[03-domains/workouts/index]] ·
[[08-security/index]]
