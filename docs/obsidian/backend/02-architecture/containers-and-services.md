---
title: "Contenedores y servicios"
type: architecture
status: verified
last_reviewed: "2026-08-06"
source_revision: "27f3fd2"
tags: [backend, architecture]
---

# Contenedores y servicios

Unidades de despliegue de la pila (fuente: `docker-compose.yml`, `Dockerfile`, `src/workers/`).
Todas las de aplicación comparten **una imagen** (`gym-sheet-backend:local`) y difieren solo en el
`command`. Vista C4: [[02-architecture/views/c4-container]].

## Servicios

| Servicio | Comando | Tipo | Puerto | Depende de |
|---|---|---|---|---|
| `postgres` | postgres:16-alpine | datastore | 5432 (interno) | — |
| `redis` | redis:7-alpine (sin persistencia) | cache/rate-limit | 6379 (interno) | — |
| `migrate` | `node dist/database/migrate.js up` | one-shot | — | postgres healthy |
| `api` | `node dist/main.js` (INFERIDO por Dockerfile) | HTTP long-running | 3000 → publica 3001 | postgres, redis, migrate |
| `worker-access` | `dist/workers/access-event.worker.js` | worker polling | — | postgres, redis, migrate |
| `worker-reminders` | `dist/workers/membership-reminder.worker.js` | worker polling | — | postgres, migrate |
| `worker-notifications` | `dist/workers/notification-delivery.worker.js` | worker polling | — | postgres, migrate |
| `worker-exercises-dataset` | `dist/workers/exercises-dataset-refresh.worker.js` | worker polling | — | postgres, migrate |

## API

Bootstrap `src/main.ts`: valida env (Zod), corre `bootstrapDatabase()` (migraciones + seeds
idempotentes) **antes** de crear Nest, aplica helmet, CORS por allowlist, `requestId` middleware,
límite de body, prefijo `api/v1`, guards/interceptores/filtro globales y `enableShutdownHooks()`.

Guards globales (orden): `ThrottlerGuard` → `JwtAuthGuard` → `RolesGuard`
(`src/app.module.ts`). Interceptores globales: `ResponseInterceptor`, `HttpMetricsInterceptor`.
Filtro global: `HttpExceptionFilter`.

## Los 4 workers

Cada worker es un `ApplicationContext` de Nest sin servidor HTTP (`bootstrapWorker`,
`src/workers/worker-bootstrap.ts`) que:

1. Llama `flushLogs()` — sin él un worker no emite logs y es inobservable
   (regla `.claude/rules/40-observability.md`).
2. Obtiene su runner y ejecuta un loop de polling hasta `SIGTERM`/`SIGINT` (`AbortController`).
3. Deja de reclamar, termina el trabajo en curso y cierra la app.

Módulos de worker (`src/workers/*.module.ts`):

- `AccessWorkerModule` → `DatabaseModule`, `AccessControlModule` → `AccessEventRunner`.
- `NotificationWorkerModule` → `DatabaseModule`, `IntegrationModule`, `NotificationsModule` →
  `MembershipReminderRunner` + `NotificationDeliveryRunner` (dos procesos, un módulo).
- `ExercisesDatasetWorkerModule` → `DatabaseModule`, `ExercisesModule` →
  `ExercisesDatasetRefreshRunner`.
- `OutboxMaintenanceModule` → comando puntual de poda (`db:outbox:prune`), no un worker persistente.

## Datastores

- **PostgreSQL 16**: fuente de verdad (44 models, 10 migraciones de negocio). `schema.sql` se aplica
  solo en primera creación del volumen; los cambios posteriores van por `migrate`.
- **Redis 7**: solo contadores de rate limiting; persistencia desactivada (pérdida segura),
  `maxmemory` 256mb `allkeys-lru`. En compose es **requerido** (`REDIS_REQUIRED=true`) porque el
  stack puede escalar la API.

Ver [[02-architecture/deployment-topology]], [[05-data/data-architecture]], [[15-reference/ports]].
