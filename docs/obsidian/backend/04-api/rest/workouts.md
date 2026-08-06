---
title: "REST · Workouts"
type: api
status: verified
last_reviewed: "2026-08-06"
source_revision: "27f3fd2"
tags: [backend, api]
---

# REST · Workouts

Controlador: `src/modules/workouts/workouts.controller.ts` (`@Controller('workouts')`)
· Servicio: `workouts.service.ts` · Esquemas: `workouts.schemas.ts`. Todo el grupo
es **propiedad por usuario** (acceso ajeno → 404). En OpenAPI.

| Método | Ruta | Body/query | Errores | Propósito |
|---|---|---|---|---|
| POST | `/workouts` | `createWorkoutSessionSchema` (`observacion?`) | 400, 409 | Inicia sesión; **una sola abierta** por usuario |
| GET | `/workouts` | `workoutSessionListSchema` (query, `pageSize` def. 20) | 400 | Historial paginado |
| GET | `/workouts/:id` | — | 404 | Sesión propia |
| PATCH | `/workouts/:id/finish` | — | 403, 404 | `EN_PROGRESO → FINALIZADA` |
| PATCH | `/workouts/:id/cancel` | — | 403, 404 | `EN_PROGRESO → CANCELADA` |
| POST | `/workouts/:sessionId/exercises` | `addSessionExerciseSchema` | 400/403/404/409 | Agrega ejercicio visible a sesión abierta |
| PATCH | `/workouts/session-exercises/:id` | `updateSessionExerciseSchema` | 400/403/404/409 | Actualiza ocurrencia |
| DELETE | `/workouts/session-exercises/:id` | — | 403, 404 | Elimina ocurrencia |
| POST | `/workouts/session-exercises/:id/sets` | `createWorkoutSetSchema` | 400/403/404/409 | Serie numerada única |
| PATCH | `/workouts/sets/:id` | `updateWorkoutSetSchema` | 400, 403, 404 | Actualiza serie propia |
| DELETE | `/workouts/sets/:id` | — | 403, 404 | Elimina serie propia |

Reglas de negocio:

- Transiciones permitidas solo desde `EN_PROGRESO`. Sesiones finalizadas/canceladas
  rechazan mutaciones (403).
- `numeroSerie` único por ejercicio de sesión → duplicado = 409.
- `WorkoutSetRequest`: `numeroSerie` 1–100, `repeticiones` 1–1000, `pesoKg` 0–2000,
  `rir` 0–10, `descansoSegAnterior` 0–7200.

Relacionado: [[training]] · [[export]] · [[04-api/pagination-filtering-sorting]] · [[03-domains/workouts/index]]
