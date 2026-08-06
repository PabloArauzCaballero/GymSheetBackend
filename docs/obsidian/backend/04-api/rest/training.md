---
title: "REST · Training (routines)"
type: api
status: verified
last_reviewed: "2026-08-06"
source_revision: "27f3fd2"
tags: [backend, api]
---

# REST · Training (routines)

Controlador: `src/modules/training/training.controller.ts` (`@Controller('routines')`)
· Servicio: `training.service.ts` · Esquemas: `training.schemas.ts`.

> **Ninguna ruta de este grupo está en OpenAPI** (13 rutas sin documentar en el
> contrato). Fuente: solo el controlador.

| Método | Ruta | Rol/Owner | Body/query | Propósito |
|---|---|---|---|---|
| POST | `/routines` | Owner | `createRoutineSchema` | Crear rutina |
| GET | `/routines` | Owner | `listRoutinesSchema` (query) | Listar (paginado) |
| GET | `/routines/assignments/me` | Owner | — | Asignaciones recibidas |
| GET | `/routines/assignments/coach` | COACH, ADMIN | — | Asignaciones hechas por el coach |
| POST | `/routines/import` | Owner | `importRoutinesSchema` | Importar rutinas |
| PATCH | `/routines/exercises/:id` | Owner | `updateRoutineExerciseSchema` | Actualizar ejercicio de rutina |
| DELETE | `/routines/exercises/:id` | Owner | — | Eliminar ejercicio de rutina |
| GET | `/routines/:id` | Owner/visible | — | Rutina para el usuario |
| PATCH | `/routines/:id` | Owner | `updateRoutineSchema` | Actualizar rutina |
| DELETE | `/routines/:id` | Owner | — | Eliminar rutina |
| POST | `/routines/:id/exercises` | Owner | `addRoutineExerciseSchema` | Añadir ejercicio |
| POST | `/routines/:id/assign` | COACH, ADMIN | `assignRoutineSchema` | Asignar rutina a cliente |
| POST | `/routines/:id/start` | Owner | — | Iniciar sesión desde la rutina |

Notas:

- Guard de rol solo en `assignments/coach` y `:id/assign` (COACH/ADMIN); el resto
  es propiedad por usuario (`@CurrentUser`), acceso ajeno → 404.
- Visibilidad de rutina modelada por `RoutineVisibility`
  (`PRIVATE`/`SHARED`/`TEMPLATE`) y `RoutineStatus`; asignaciones por
  `RoutineAssignmentStatus`.
- `:id/start` conecta con el dominio Workouts (crea sesión).

Relacionado: [[workouts]] · [[04-api/authorization]] · [[03-domains/training/index]]
