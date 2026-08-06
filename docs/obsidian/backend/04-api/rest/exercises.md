---
title: "REST · Exercises (catálogo, media, favoritos, dataset)"
type: api
status: verified
last_reviewed: "2026-08-06"
source_revision: "27f3fd2"
tags: [backend, api]
---

# REST · Exercises

Controladores del módulo `exercises`:

- `exercises.controller.ts` — `ExercisesController` (`exercises`),
  `AdminExercisesController` (`admin/exercises/global`, ADMIN),
  `UserExercisesController` (`user-exercises`, favoritos).
- `exercise-media.controller.ts` — multimedia.
- `import/exercises-dataset.controller.ts` — importación del dataset externo (ADMIN).

Servicios: `exercises.service.ts`, `exercise-media.service.ts`,
`import/exercises-dataset.service.ts`. Esquemas: `exercises.schemas.ts`,
`import/exercises-dataset.schemas.ts`.

## Catálogo — `ExercisesController`

| Método | Ruta | Rol/Owner | Body/query | Propósito |
|---|---|---|---|---|
| GET | `/exercises` | JWT | `exerciseFilterSchema` (query) | Globales + personales activos; paginado (def. 25) y filtrable |
| GET | `/exercises/:id` | visible | — | 404 si no es visible |
| POST | `/exercises/personal` | Owner | `createPersonalExerciseSchema` | Crea personal |
| PATCH | `/exercises/:id` | Owner | `updateExerciseSchema` | Solo personal propio |
| DELETE | `/exercises/:id` | Owner | — | Inhabilita personal |

Filtros de `GET /exercises`: `search`, `grupoMuscular`, `equipoId` (UUID),
`bodyPart`, `targetMuscle`, `dataSource` — ver [[04-api/pagination-filtering-sorting]].

## Globales (admin) — `AdminExercisesController` (`@Roles(ADMIN)`)

| Método | Ruta | Body | Propósito |
|---|---|---|---|
| POST | `/admin/exercises/global` | `createGlobalExerciseSchema` | Crea global |
| PATCH | `/admin/exercises/global/:id` | `updateExerciseSchema` | Actualiza global |
| DELETE | `/admin/exercises/global/:id` | — | Inhabilita global |

## Favoritos — `UserExercisesController` (`user-exercises`)

| Método | Ruta | Owner | Errores | Propósito |
|---|---|---|---|---|
| GET | `/user-exercises` | Owner | — | Frecuentes propios |
| POST | `/user-exercises/:exerciseId` | Owner | 404, 409 | Agrega único (409 si duplicado) |
| DELETE | `/user-exercises/:exerciseId` | Owner | 404 | Quita |

## Multimedia — `exercise-media.controller.ts`

| Método | Ruta | Rol/Owner | Body | Propósito |
|---|---|---|---|---|
| GET | `/exercises/:exerciseId/media` | visible | — | Multimedia activa |
| POST | `/exercises/:exerciseId/media` | Owner o ADMIN (global) | `createExerciseMediaSchema` | Registra referencia |
| DELETE | `/exercise-media/:mediaId` | Owner o ADMIN (global) | — | Inhabilita y promueve nuevo primario |

Controles de media: URL **HTTPS** ≤2048, `altText` obligatorio, máx. 10 activas por
ejercicio, un solo primario activo (reforzado en BD), inactivación lógica. Registrar
una URL no otorga derechos de copia; media del dataset externo deshabilitada salvo
confirmación de licencia.

## Importación del dataset externo — `import/exercises-dataset.controller.ts` (`@Roles(ADMIN)`)

| Método | Ruta | Body | Errores | Propósito |
|---|---|---|---|---|
| GET | `/admin/exercises/import/exercises-dataset/status` | — | 403 | Lee checkpoint PostgreSQL sin contactar el origen |
| POST | `/admin/exercises/import/exercises-dataset` | `exerciseDatasetImportOptionsSchema` (`dryRun?`, `importMedia?`) | 400, 403, 503 | Valida e importa idempotentemente |

Conector **deshabilitado por defecto** (`EXERCISES_DATASET_ENABLED=false`). Defensas
SSRF: HTTPS-only, host allowlist (`EXERCISES_DATASET_ALLOWED_HOSTS`), rechazo de
redirecciones, timeout y tope de bytes, validación Zod completa, lotes
transaccionales acotados, upsert race-safe por identidad de origen, dry run, media
externa off salvo licencia confirmada.

Relacionado: [[equipment]] · [[04-api/authorization]] · [[03-domains/exercises/index]]
