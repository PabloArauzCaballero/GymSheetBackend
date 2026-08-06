---
title: "Workouts"
type: domain
status: verified
criticality: medium
last_reviewed: "2026-08-06"
source_revision: "27f3fd2"
domain: "workouts"
source_files: [
  "src/modules/workouts/workouts.controller.ts",
  "src/modules/workouts/workouts.service.ts",
  "src/modules/workouts/workouts.repository.ts",
  "src/modules/workouts/workouts.schemas.ts",
  "src/modules/workouts/workout.mapper.ts"
]
tags: [backend, domain]
related: ["[[03-domains/training/index]]", "[[03-domains/exercises/index]]", "[[03-domains/export/index]]"]
---

# Workouts

## Resumen

Registro de sesiones de entrenamiento en vivo: sesiones, ejercicios de sesión y sets. Modelo
self-service puro por propiedad (sin roles): cada usuario solo ve y muta lo suyo.

## Responsabilidad

- Iniciar/finalizar/cancelar sesiones de entrenamiento.
- Añadir/editar/eliminar ejercicios de sesión y sets (reps, peso, RIR, descanso).

## Límites

- No programa rutinas (eso es `training`); recibe llamadas de `training` para sembrar la sesión.
- No valida catálogo de ejercicios (consume `exercises`).

## Entradas

HTTP autenticado (`/workouts/*`), Zod (`workouts.schemas.ts`), `@CurrentUser`.

## Salidas

DTOs en español vía `workout.mapper.ts`; sesión hidratada (sesión→ejercicios→sets).

## Casos de uso

Usuario: iniciar sesión, listar/ver sesiones propias, finalizar/cancelar, gestionar ejercicios y sets.
`training.startSessionFromRoutine` invoca `startSession` + `addExerciseToSession`.

## Reglas de negocio

- `startSession` rechaza si existe una sesión abierta (índice único parcial
  `uq_active_workout_per_user`; carrera → 409).
- `finishSession`/`cancelSession` requieren estado IN_PROGRESS.
- `assertSessionInProgress` bloquea mutaciones de sesiones finalizadas/canceladas (403, regla de
  estado, no de propiedad).
- `addSet`: check de `setNumber` duplicado bajo lock antes de insertar (409).

## Componentes principales

| Componente | Tipo | Responsabilidad | Evidencia |
|---|---|---|---|
| `WorkoutsController` | Controller | Rutas `/workouts/*` | `workouts.controller.ts` |
| `WorkoutsService` | Service | Sesiones, ejercicios de sesión, sets | `workouts.service.ts` |
| `WorkoutsRepository` | Repository | Persistencia + lock en `addSet` | `workouts.repository.ts` |

## Entidades y datos

`WorkoutSessionModel` (`sesiones_entrenamiento`; `userId`, startedAt, finishedAt, status),
`WorkoutSessionExerciseModel` (`sesiones_ejercicios`; order, isEmphasis),
`WorkoutSetModel` (`series_entrenamiento`; setNumber, repetitions, `weightKg`, rir,
previousRestSeconds). Relaciones: sesión → ejercicio de sesión → set. Nota: tablas en esquema por
defecto con nombres en español (a diferencia de `training`). Detalle: [[05-data/index]].

## Endpoints o contratos

`POST/GET /workouts`, `GET/PATCH(finish)/PATCH(cancel) /workouts/:id`,
`POST /workouts/:sessionId/exercises`, `PATCH|DELETE /workouts/session-exercises/:id`,
`POST /workouts/session-exercises/:id/sets`, `PATCH|DELETE /workouts/sets/:id`. Sin `@Roles`.
[[04-api/index]].

## Eventos

Ninguno.

## Dependencias

`ExercisesService.getVisibleExerciseOrFail`. Consumido por `training` y `export`.

## Autenticación y permisos

Ownership puro por `userId`. Acceso ajeno a sesión/ejercicio/set → **404**
(`getSessionExerciseOwnedByUserOrFail`, `getSetOwnedByUserOrFail`): cumple la regla del repo. Estado
inválido → 403.

## Manejo de errores

`ConflictException` (sesión abierta, ejercicio/orden duplicado, set duplicado; usa
`instanceof UniqueConstraintError`), `NotFoundException` (incl. cross-user), `ForbiddenException`
(sesión no IN_PROGRESS). Errores no relacionados se re-lanzan (probado).

## Transacciones y consistencia

`addSet` en transacción con `SELECT ... FOR UPDATE` sobre el check de `setNumber`. El inicio de sesión
depende del índice único parcial `uq_active_workout_per_user` (`INFERIDO`: definido en migración).

## Procesamiento asíncrono

Ninguno.

## Observabilidad

Sin métricas específicas (`INFERIDO`).

## Pruebas

`workouts.service.spec.ts`: aislamiento horizontal (`deleteSet` ajeno → 404), regla de estado
(`updateSet` sobre COMPLETED → 403), carrera de `startSession` → 409, error no enmascarado. Gaps:
`addSet` (lock), `addExerciseToSession` (conflicto), finish/cancel, paginación.

## Riesgos

- Corrección de `startSession` depende de que exista el índice parcial; si falta la migración,
  sesiones activas duplicadas.
- Sin transacción en flujos multi-paso salvo `addSet` (finish/cancel son de una fila).
- Inconsistencia de esquema/nombres respecto a `training` (cosmético/migración).

## Referencias al código

- `workouts.service.ts` → `startSession`, `addSet`, `getSetOwnedByUserOrFail`,
  `assertSessionInProgress`.
- `workouts.repository.ts` → `addSet` (lock).
- `workouts.schemas.ts` → `createWorkoutSessionSchema`, `addSessionExerciseSchema`,
  `createWorkoutSetSchema`.

## Relaciones

[[03-domains/training/index]] · [[03-domains/exercises/index]] · [[03-domains/export/index]]
