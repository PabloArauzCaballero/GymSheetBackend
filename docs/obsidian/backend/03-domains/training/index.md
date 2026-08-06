---
title: "Training"
type: domain
status: verified
criticality: high
last_reviewed: "2026-08-06"
source_revision: "27f3fd2"
domain: "training"
source_files: [
  "src/modules/training/training.controller.ts",
  "src/modules/training/training.service.ts",
  "src/modules/training/training.repository.ts",
  "src/modules/training/training.schemas.ts",
  "src/modules/training/training.module.ts"
]
tags: [backend, domain]
related: ["[[03-domains/workouts/index]]", "[[03-domains/exercises/index]]", "[[03-domains/users/index]]"]
---

# Training

## Resumen

Dominio núcleo de programación de entrenamiento. Gestiona rutinas (privadas, compartidas y
plantillas), sus ejercicios ordenados, y asignaciones de coach a cliente. Puente hacia `workouts`:
`startSessionFromRoutine` crea una sesión en vivo replicando los ejercicios de la rutina.

## Responsabilidad

- CRUD de rutinas con visibilidad (PRIVATE/SHARED/TEMPLATE) y objetivo.
- Gestión de ejercicios de rutina (orden, series objetivo, rango de reps, peso, RIR, descanso).
- Asignación de rutinas a clientes (coach/admin), con días de semana y fecha programada.
- Import masivo de rutinas.

## Límites

- No ejecuta la sesión de entrenamiento (delega en `workouts`).
- No define el catálogo de ejercicios (consume `exercises`).

## Entradas

- HTTP autenticado (`/routines/*`), validado por Zod (`training.schemas.ts`) y `UuidParamPipe`.

## Salidas

- DTOs en español vía `training.mapper.ts`.
- Sesión hidratada al iniciar desde rutina.

## Casos de uso

- Usuario: crear/editar/listar rutinas propias, ver plantillas, iniciar sesión desde rutina.
- COACH/ADMIN: asignar rutinas a clientes, ver sus asignaciones emitidas.
- Import masivo de rutinas (por fila, tolerante a fallos).

## Reglas de negocio

- `assertVisibilityAllowed`: solo staff (ADMIN/COACH) publica TEMPLATE.
- `assignRoutine`: valida cliente ACTIVO, bloquea auto-asignación, auto-promueve PRIVATE→SHARED,
  unicidad de asignación activa → 409.
- `addExercise`: resuelve ejercicio por id o nombre; colisión de orden → 409.
- Import: transacción por rutina; recolecta `ImportRoutineResult` por fila, nunca falla el lote entero.

## Componentes principales

| Componente | Tipo | Responsabilidad | Evidencia |
|---|---|---|---|
| `TrainingController` | Controller | Rutas `/routines/*` | `training.controller.ts` |
| `TrainingService` | Service | Rutinas, ejercicios, asignaciones, import, start | `training.service.ts` |
| `TrainingRepository` | Repository | Persistencia; inyecta `ExerciseModel`/`UserModel` | `training.repository.ts` |
| `translateConflict` | Helper | Traduce unicidad a 409 | `training.service.ts` |

## Entidades y datos

Esquema `training`: `RoutineModel` (routines; `createdByUserId`, visibility, status),
`RoutineExerciseModel` (routine_exercises; orden, targetSets, reps, `targetWeightKg`, targetRir,
restSeconds), `RoutineAssignmentModel` (routine_assignments; `clientUserId`, `assignedByUserId`,
weekdays JSONB, scheduledFor). Relaciones: rutina → ejercicio de rutina → ejercicio; asignación →
rutina/cliente/coach. Detalle: [[05-data/index]].

## Endpoints o contratos

`POST/GET /routines`, `GET /routines/assignments/me`, `GET /routines/assignments/coach`
(`@Roles(COACH,ADMIN)`), `POST /routines/import`, `PATCH|DELETE /routines/exercises/:id`,
`GET|PATCH|DELETE /routines/:id`, `POST /routines/:id/exercises`, `POST /routines/:id/assign`
(`@Roles(COACH,ADMIN)`), `POST /routines/:id/start`. Rutas estáticas declaradas antes de `:id`.
[[04-api/index]].

## Eventos

Ninguno. No emite domain events ni usa outbox.

## Dependencias

`ExercisesModule` (`getVisibleExerciseOrFail`), `WorkoutsModule` (`startSession`). El repositorio
inyecta directamente `ExerciseModel` (lookup por nombre) y `UserModel` (lookup de cliente).

## Autenticación y permisos

Ownership en el service: `assertCanEditRoutine` (dueño o ADMIN), `assertCanViewRoutine` (dueño,
TEMPLATE, ADMIN o con asignación activa). `@Roles(COACH,ADMIN)` en asignaciones.
`RIESGO/ARCH-2`: edición/visualización no autorizada de una rutina **existente** lanza
`ForbiddenException` (403), lo que contradice la regla del repo (acceso ajeno → 404); recurso
inexistente sí devuelve 404.

## Manejo de errores

`ConflictException` (unicidad de orden/asignación), `NotFoundException` (rutina/ejercicio/cliente),
`BadRequestException` (id/nombre de ejercicio faltante, auto-asignación), `ForbiddenException`
(permisos). `translateConflict` compara por `error.name` (string), no `instanceof`.

## Transacciones y consistencia

`importRoutines` usa transacción por rutina (atómica). `RIESGO`: `assignRoutine` hace update de
visibilidad + insert de asignación sin transacción única (dos escrituras no atómicas).
`startSessionFromRoutine` itera N `addExerciseToSession` sin transacción (sesión parcial posible).

## Procesamiento asíncrono

Ninguno.

## Observabilidad

Sin métricas/logging específicos observados (`INFERIDO`).

## Pruebas

Sin spec en el módulo. `RIESGO`: lógica de autorización e import sin tests unitarios.

## Riesgos

- `ARCH-2` — 403 en acceso ajeno a rutina existente (la regla exige 404).
- `assignRoutine` no atómico.
- `translateConflict` por `error.name` (frágil vs `instanceof`, como sí hace `workouts`).
- `startSessionFromRoutine` sin transacción → sesión parcial ante fallo intermedio.
- Sin cobertura de pruebas del módulo.

## Referencias al código

- `training.service.ts` → `createRoutine`, `addExercise`, `assignRoutine`,
  `startSessionFromRoutine`, `assertCanEditRoutine`, `translateConflict`.
- `training.repository.ts` → `createRoutine`, `addExercise` (transacción opcional).
- `training.schemas.ts` → `createRoutineSchema`, `addRoutineExerciseSchema`, `assignRoutineSchema`,
  `importRoutinesSchema`.

## Relaciones

[[03-domains/workouts/index]] · [[03-domains/exercises/index]] · [[03-domains/users/index]]
