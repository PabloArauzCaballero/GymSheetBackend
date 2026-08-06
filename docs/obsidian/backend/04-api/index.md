---
title: "API REST — Índice y catálogo maestro"
type: api
status: verified
last_reviewed: "2026-08-06"
source_revision: "27f3fd2"
tags: [backend, api]
---

# API REST — Índice y catálogo maestro

API HTTP autenticada de GymSheet (NestJS 11). Toda ruta cuelga del prefijo
configurable `API_PREFIX` (por defecto `api/v1`). La seguridad es **cerrada por
defecto**: guards globales `JwtAuthGuard` + `RolesGuard` obligan JWT en cada
petición salvo que el handler/controlador lleve `@Public()`.

- Autenticación → [[authentication]]
- Autorización, propiedad y roles → [[authorization]] · [[08-security/authorization]]
- Convenciones (prefijo, envelope, Zod, mappers) → [[conventions]]
- Modelo de error → [[error-model]]
- Paginación/filtros/orden → [[pagination-filtering-sorting]]
- Rate limiting → [[rate-limits]]
- Versionado → [[versioning]]

## Cifras de la superficie

| Fuente | Recuento | Nota |
|---|---|---|
| Rutas HTTP en `src/modules/*` | **113** | 26 clases `@Controller` en 17 archivos de módulo |
| Rutas del gateway (`src/gateway`) | **2** | módulo aparte, públicas |
| **Total rutas HTTP** | **115** | catálogo completo de abajo |
| Paths en `docs/endpoints/openapi.yaml` | **46** | contrato existente (subconjunto) |

> El contexto del vault cita «113 rutas en 19 controllers»: las 113 corresponden a
> los controllers de `src/modules`; sumando los 2 endpoints del gateway el total es
> 115. Ver contradicciones OpenAPI↔código en la sección final.

## Convenciones de las columnas

- **Auth**: `Público` = `@Public()` (sin JWT). `JWT` = requiere access token válido y
  usuario activo revalidado en PostgreSQL.
- **Rol/Owner**: rol exigido por `@Roles(...)` y/o verificación de **propiedad** en el
  servicio. `Owner` = el recurso se filtra por `user.id`; acceso ajeno responde **404**
  (ver [[authorization]]).

## ENDPOINT CATALOG

### Auth — `auth.controller.ts`
| Método | Ruta | Módulo | Auth | Rol/Owner | Nota |
|---|---|---|---|---|---|
| POST | `/auth/register` | auth | Público | — | Rate limit estricto `AUTH_RATE_LIMIT_MAX`. 409 si el email existe |
| POST | `/auth/login` | auth | Público | — | Rate limit estricto. Anti-enumeración (bcrypt compare siempre). Ver [[rest/auth/login]] |
| GET | `/auth/me` | auth | JWT | self | Devuelve el principal revalidado |

### Users — `users.controller.ts`
| Método | Ruta | Módulo | Auth | Rol/Owner | Nota |
|---|---|---|---|---|---|
| GET | `/users/me` | users | JWT | self | Usuario activo mapeado (nunca ORM directo) |

### Profile — `profiles.controller.ts`
| Método | Ruta | Módulo | Auth | Rol/Owner | Nota |
|---|---|---|---|---|---|
| GET | `/profile` | profiles | JWT | Owner | Perfil antropométrico propio; 404 si no existe |
| POST | `/profile` | profiles | JWT | Owner | Crea o reemplaza (upsert) |
| PATCH | `/profile` | profiles | JWT | Owner | Actualiza (mismo upsert) |

### Onboarding / Body measurements — `onboarding.controller.ts`
| Método | Ruta | Módulo | Auth | Rol/Owner | Nota |
|---|---|---|---|---|---|
| GET | `/me/onboarding` | profiles | JWT | Owner | Estado y campos pendientes |
| PUT | `/me/onboarding/profile` | profiles | JWT | Owner | Medidas, unidades, fecha |
| PUT | `/me/onboarding/goals` | profiles | JWT | Owner | Objetivo principal |
| PUT | `/me/onboarding/preferences` | profiles | JWT | Owner | Preferencias y consentimientos |
| PUT | `/me/onboarding/equipment` | profiles | JWT | Owner | Equipamiento disponible |
| POST | `/me/onboarding/complete` | profiles | JWT | Owner | Completa idempotentemente; 422 si faltan campos |
| GET | `/me/body-measurements` | profiles | JWT | Owner | Historial corporal ordenado |
| POST | `/me/body-measurements` | profiles | JWT | Owner | Añade medición sin sobrescribir |

### Equipment — `equipment.controller.ts`
| Método | Ruta | Módulo | Auth | Rol/Owner | Nota |
|---|---|---|---|---|---|
| GET | `/equipment` | equipment | JWT | — | Catálogo disponible |
| POST | `/admin/equipment` | equipment | JWT | ADMIN | Crear |
| PATCH | `/admin/equipment/:id` | equipment | JWT | ADMIN | Actualizar |
| DELETE | `/admin/equipment/:id` | equipment | JWT | ADMIN | Inhabilita sin borrar historial |

### Exercises — `exercises.controller.ts`
| Método | Ruta | Módulo | Auth | Rol/Owner | Nota |
|---|---|---|---|---|---|
| GET | `/exercises` | exercises | JWT | — | Globales + personales activos del usuario; paginado y filtrable |
| GET | `/exercises/:id` | exercises | JWT | visible | 404 si no es visible |
| POST | `/exercises/personal` | exercises | JWT | Owner | Crea ejercicio personal |
| PATCH | `/exercises/:id` | exercises | JWT | Owner | Solo personal propio |
| DELETE | `/exercises/:id` | exercises | JWT | Owner | Inhabilita personal propio |
| POST | `/admin/exercises/global` | exercises | JWT | ADMIN | Crea global |
| PATCH | `/admin/exercises/global/:id` | exercises | JWT | ADMIN | Actualiza global |
| DELETE | `/admin/exercises/global/:id` | exercises | JWT | ADMIN | Inhabilita global |

### Favorites — `exercises.controller.ts` (`user-exercises`)
| Método | Ruta | Módulo | Auth | Rol/Owner | Nota |
|---|---|---|---|---|---|
| GET | `/user-exercises` | exercises | JWT | Owner | Frecuentes del usuario |
| POST | `/user-exercises/:exerciseId` | exercises | JWT | Owner | Agrega único; 409 si duplicado |
| DELETE | `/user-exercises/:exerciseId` | exercises | JWT | Owner | Quita frecuente |

### Exercise media — `exercise-media.controller.ts`
| Método | Ruta | Módulo | Auth | Rol/Owner | Nota |
|---|---|---|---|---|---|
| GET | `/exercises/:exerciseId/media` | exercises | JWT | visible | Multimedia activa |
| POST | `/exercises/:exerciseId/media` | exercises | JWT | Owner o ADMIN (global) | Registra referencia; máx. 10 activas |
| DELETE | `/exercise-media/:mediaId` | exercises | JWT | Owner o ADMIN (global) | Inhabilita y promueve nuevo primario |

### Exercises dataset import — `import/exercises-dataset.controller.ts`
| Método | Ruta | Módulo | Auth | Rol/Owner | Nota |
|---|---|---|---|---|---|
| GET | `/admin/exercises/import/exercises-dataset/status` | exercises | JWT | ADMIN | Lee checkpoint sin contactar origen |
| POST | `/admin/exercises/import/exercises-dataset` | exercises | JWT | ADMIN | Deshabilitado por defecto (`EXERCISES_DATASET_ENABLED`); SSRF allowlist |

### Workouts — `workouts.controller.ts`
| Método | Ruta | Módulo | Auth | Rol/Owner | Nota |
|---|---|---|---|---|---|
| POST | `/workouts` | workouts | JWT | Owner | Una sola sesión abierta por usuario; 409 si ya hay |
| GET | `/workouts` | workouts | JWT | Owner | Historial paginado (`pageSize` def. 20) |
| GET | `/workouts/:id` | workouts | JWT | Owner | Sesión propia |
| PATCH | `/workouts/:id/finish` | workouts | JWT | Owner | `EN_PROGRESO→FINALIZADA` |
| PATCH | `/workouts/:id/cancel` | workouts | JWT | Owner | `EN_PROGRESO→CANCELADA` |
| POST | `/workouts/:sessionId/exercises` | workouts | JWT | Owner | Agrega ejercicio visible a sesión abierta |
| PATCH | `/workouts/session-exercises/:id` | workouts | JWT | Owner | Actualiza ocurrencia |
| DELETE | `/workouts/session-exercises/:id` | workouts | JWT | Owner | Elimina ocurrencia |
| POST | `/workouts/session-exercises/:id/sets` | workouts | JWT | Owner | Serie numerada única; 409 si repite |
| PATCH | `/workouts/sets/:id` | workouts | JWT | Owner | Actualiza serie propia |
| DELETE | `/workouts/sets/:id` | workouts | JWT | Owner | Elimina serie propia |

### Training / Routines — `training.controller.ts` — **NO en OpenAPI**
| Método | Ruta | Módulo | Auth | Rol/Owner | Nota |
|---|---|---|---|---|---|
| POST | `/routines` | training | JWT | Owner | Crear rutina |
| GET | `/routines` | training | JWT | Owner | Listar (paginado/filtro) |
| GET | `/routines/assignments/me` | training | JWT | Owner | Asignaciones recibidas |
| GET | `/routines/assignments/coach` | training | JWT | COACH, ADMIN | Asignaciones hechas por el coach |
| POST | `/routines/import` | training | JWT | Owner | Importa rutinas |
| PATCH | `/routines/exercises/:id` | training | JWT | Owner | Actualiza ejercicio de rutina |
| DELETE | `/routines/exercises/:id` | training | JWT | Owner | Elimina ejercicio de rutina |
| GET | `/routines/:id` | training | JWT | Owner/visible | Rutina para el usuario |
| PATCH | `/routines/:id` | training | JWT | Owner | Actualiza rutina |
| DELETE | `/routines/:id` | training | JWT | Owner | Elimina rutina |
| POST | `/routines/:id/exercises` | training | JWT | Owner | Añade ejercicio |
| POST | `/routines/:id/assign` | training | JWT | COACH, ADMIN | Asigna rutina |
| POST | `/routines/:id/start` | training | JWT | Owner | Inicia sesión desde rutina |

### Export — `export.controller.ts`
| Método | Ruta | Módulo | Auth | Rol/Owner | Nota |
|---|---|---|---|---|---|
| GET | `/export/workout-history` | export | JWT | Owner | JSON acotado; 413 si excede límite |
| GET | `/export/workout-history/csv` | export | JWT | Owner | `text/csv` con neutralización de fórmulas |

### Membership — `membership.controller.ts`
| Método | Ruta | Módulo | Auth | Rol/Owner | Nota |
|---|---|---|---|---|---|
| GET | `/memberships/me` | membership | JWT | Owner | **NO en OpenAPI** |
| GET | `/membership/plans` | membership | JWT | — | Planes de tienda |
| GET | `/membership/plans/:id` | membership | JWT | — | Plan comercial |
| GET | `/me/membership` | membership | JWT | Owner | Proyección de membresía |
| GET | `/me/accesses` | membership | JWT | Owner | Derechos efectivos |
| GET | `/me/membership/options` | membership | JWT | Owner | Opciones según estado |
| POST | `/me/membership/renewal-intent` | membership | JWT | Owner | Intención idempotente; no concede acceso |
| POST | `/me/membership/extension-intent` | membership | JWT | Owner | Intención idempotente; no extiende aún |
| GET | `/admin/membership/plans` | membership | JWT | ADMIN, FRONT_DESK | **NO en OpenAPI** |
| POST | `/admin/membership/plans` | membership | JWT | ADMIN | **NO en OpenAPI** |
| PATCH | `/admin/membership/plans/:id` | membership | JWT | ADMIN | **NO en OpenAPI** |
| PATCH | `/admin/membership/plans/:id/scopes` | membership | JWT | ADMIN | Reemplaza scopes de acceso. **NO en OpenAPI** |
| POST | `/admin/membership/customers` | membership | JWT | ADMIN, FRONT_DESK | **NO en OpenAPI** |
| GET | `/admin/membership/customers` | membership | JWT | ADMIN, FRONT_DESK | Paginado. **NO en OpenAPI** |
| POST | `/admin/membership/memberships` | membership | JWT | ADMIN, FRONT_DESK | **NO en OpenAPI** |
| GET | `/admin/membership/memberships` | membership | JWT | ADMIN, FRONT_DESK | Paginado. **NO en OpenAPI** |
| PATCH | `/admin/membership/memberships/:id/status` | membership | JWT | ADMIN, FRONT_DESK | Cambia estado. **NO en OpenAPI** |
| POST | `/admin/membership/staff` | membership | JWT | ADMIN | Alta de staff. **NO en OpenAPI** |
| PATCH | `/admin/membership/staff/:userId/status` | membership | JWT | ADMIN | **NO en OpenAPI** |
| POST | `/admin/membership/intents/:id/confirm` | membership | JWT | ADMIN | Confirma intención y aplica tiempo transaccionalmente |

### Access control — `access-control.controller.ts` — **NO en OpenAPI**
| Método | Ruta | Módulo | Auth | Rol/Owner | Nota |
|---|---|---|---|---|---|
| GET | `/access/me` | access-control | JWT | Owner | Historial de acceso propio (filtrable) |
| GET | `/admin/access/devices` | access-control | JWT | ADMIN, FRONT_DESK | Lista dispositivos |
| POST | `/admin/access/devices` | access-control | JWT | ADMIN | Crea dispositivo |
| PATCH | `/admin/access/devices/:id/status` | access-control | JWT | ADMIN | Cambia estado |
| GET | `/admin/access/events/:id` | access-control | JWT | ADMIN, FRONT_DESK | Consulta evento |
| GET | `/admin/access/history` | access-control | JWT | ADMIN, FRONT_DESK | Historial global filtrable |

### Access credentials — `access-credential.controller.ts` — **NO en OpenAPI**
| Método | Ruta | Módulo | Auth | Rol/Owner | Nota |
|---|---|---|---|---|---|
| GET | `/access/credentials/me` | access-control | JWT | Owner | Credenciales propias |
| POST | `/admin/access/credentials/pin` | access-control | JWT | ADMIN, FRONT_DESK | Crea credencial PIN |
| POST | `/admin/access/credentials/external-reference` | access-control | JWT | ADMIN, FRONT_DESK | Referencia externa (biometría en adapter) |
| GET | `/admin/access/credentials/user/:userId` | access-control | JWT | ADMIN, FRONT_DESK | Credenciales de un usuario |
| PATCH | `/admin/access/credentials/:id/revoke` | access-control | JWT | ADMIN, FRONT_DESK | Revoca |

### Access mock — `mock-access.controller.ts` — **NO en OpenAPI · endpoint MOCK**
| Método | Ruta | Módulo | Auth | Rol/Owner | Nota |
|---|---|---|---|---|---|
| POST | `/admin/access/mock/events` | access-control | JWT | ADMIN | Encola evento de acceso simulado. Gated por `ACCESS_MOCK_ENABLED`; **prohibido en producción** (validación de env) |

### Facilities — `facilities.controller.ts` — **NO en OpenAPI**
| Método | Ruta | Módulo | Auth | Rol/Owner | Nota |
|---|---|---|---|---|---|
| GET | `/admin/facilities/branches` | facilities | JWT | ADMIN, FRONT_DESK | Sucursales paginadas |
| POST | `/admin/facilities/branches` | facilities | JWT | ADMIN | Crear sucursal |
| PATCH | `/admin/facilities/branches/:id` | facilities | JWT | ADMIN | Actualizar sucursal |
| GET | `/admin/facilities/rooms` | facilities | JWT | ADMIN, FRONT_DESK | Salas (filtro `branchId`) |
| POST | `/admin/facilities/rooms` | facilities | JWT | ADMIN | Crear sala |
| PATCH | `/admin/facilities/rooms/:id` | facilities | JWT | ADMIN | Actualizar sala |
| GET | `/admin/facilities/access-points` | facilities | JWT | ADMIN, FRONT_DESK | Puntos de acceso (filtro `branchId`) |
| POST | `/admin/facilities/access-points` | facilities | JWT | ADMIN | Crear punto de acceso |
| POST | `/admin/facilities/equipment-assignments` | facilities | JWT | ADMIN | Asigna equipamiento a sala |
| GET | `/admin/facilities/maintenance` | facilities | JWT | ADMIN, FRONT_DESK | Mantenimientos filtrables |
| POST | `/admin/facilities/maintenance` | facilities | JWT | ADMIN, FRONT_DESK | Programa mantenimiento |
| PATCH | `/admin/facilities/maintenance/:id/start` | facilities | JWT | ADMIN, FRONT_DESK | Inicia mantenimiento |
| PATCH | `/admin/facilities/maintenance/:id/complete` | facilities | JWT | ADMIN, FRONT_DESK | Completa mantenimiento |

### Notifications — `notification.controller.ts` — **NO en OpenAPI**
| Método | Ruta | Módulo | Auth | Rol/Owner | Nota |
|---|---|---|---|---|---|
| GET | `/notifications/me` | notifications | JWT | Owner | Notificaciones propias filtrables |
| PATCH | `/notifications/:id/read` | notifications | JWT | Owner | Marca como leída |
| GET | `/notifications/preferences/me` | notifications | JWT | Owner | Preferencias propias |
| PATCH | `/notifications/preferences/me` | notifications | JWT | Owner | Actualiza preferencias/consentimientos |

### Health — `health.controller.ts` — (contrato en `openapi-observability.yaml`)
| Método | Ruta | Módulo | Auth | Rol/Owner | Nota |
|---|---|---|---|---|---|
| GET | `/health/live` | health | Público | — | Liveness sin dependencias. `@SkipThrottle` |
| GET | `/health/ready` | health | Público | — | Readiness (PostgreSQL, migraciones, Redis); 503 si degradado |
| GET | `/health/metrics` | health | Público* | token opcional | Prometheus; `MetricsScrapeGuard` exige `METRICS_SCRAPE_TOKEN` si está fijado |

### Gateway — `gateway.controller.ts` (`src/gateway`)
| Método | Ruta | Módulo | Auth | Rol/Owner | Nota |
|---|---|---|---|---|---|
| GET | `/gateway/health` | gateway | Público | — | Liveness de compatibilidad |
| GET | `/gateway/routes` | gateway | Público | — | Resumen de capacidades sin detalle privilegiado |

## Brechas y contradicciones (código ↔ OpenAPI)

- **OpenAPI cubre 46 de 115 rutas.** No documentan: `routines/*` (training, 13),
  la administración de membresía salvo `intents/:id/confirm` (12), `memberships/me`,
  `access-control` (6), `access-credential` (5), `mock-access` (1), `facilities` (13),
  `notifications` (4). `health/*` vive en `openapi-observability.yaml`, no en
  `openapi.yaml`.
- **`POST /auth/refresh` NO existe** en el código (ni ruta ni servicio), aunque el
  entorno define `JWT_REFRESH_SECRET`/`JWT_REFRESH_EXPIRES_IN`. Ver [[authentication]].
- **Endpoint mock**: `POST /admin/access/mock/events` solo debe existir fuera de
  producción (`ACCESS_MOCK_ENABLED`), la validación de env lo prohíbe en `production`.
- El `AuthEnvelope` de OpenAPI lista roles `[ADMIN, CLIENTE, ENTRENADOR_EXTERNO,
  COACH, FRONT_DESK]`, consistente con el enum `UserRole` del código.

Dominios relacionados: [[03-domains/membership/index]] · [[03-domains/access-control/index]] ·
[[03-domains/training/index]] · [[03-domains/workouts/index]] · [[03-domains/exercises/index]] ·
[[03-domains/profiles/index]] · [[03-domains/notifications/index]] · [[03-domains/facilities/index]] ·
[[03-domains/equipment/index]]
