---
title: "Integration"
type: domain
status: verified
criticality: high
last_reviewed: "2026-08-06"
source_revision: "27f3fd2"
domain: "integration"
source_files: [
  "src/modules/integration/outbox.service.ts",
  "src/modules/integration/outbox.repository.ts",
  "src/modules/integration/domain-event.publisher.ts",
  "src/modules/integration/domain-event.catalog.ts",
  "src/modules/integration/outbox-metrics.service.ts",
  "src/modules/integration/outbox-retention.service.ts"
]
tags: [backend, domain]
related: ["[[03-domains/notifications/index]]", "[[03-domains/access-control/index]]", "[[03-domains/health/index]]"]
---

# Integration

## Resumen

Módulo de infraestructura de mensajería (sin controlador). Implementa el patrón **transactional
outbox** (ADR-0005): un log inmutable de domain events y una cola de jobs que se encolan en la
**misma transacción** que el cambio de negocio, garantizando entrega at-least-once sin two-phase
commit. Incluye métricas Prometheus, retención/poda y modelos de import legacy.

## Responsabilidad

- Persistir eventos de dominio (`domain_events`) y encolar jobs de entrega (`outbox_jobs`) atómicamente.
- Reclamar/completar/fallar jobs con lease optimista y backoff.
- Exponer métricas de cola y podar jobs completados.

## Límites

- No entrega mensajes (los workers/consumidores lo hacen; p.ej. `notifications`).
- No expone HTTP (las métricas las publica `health`).

## Entradas

- API tipada interna: `OutboxService.enqueue`, `DomainEventPublisher.record/recordAndEnqueue`.
- Workers que llaman `claim/complete/fail` y `prune`.

## Salidas

- Filas en `integration.domain_events` y `integration.outbox_jobs`.
- Texto Prometheus (`renderPrometheus`).

## Casos de uso

- Productores (membership, facilities, access-control, notifications) registran eventos.
- Worker de entrega reclama jobs de la cola `notifications.delivery`.
- CLI/worker de retención poda jobs COMPLETED.

## Reglas de negocio

- `enqueue` por defecto `maxAttempts=5`, `status=PENDING`, `availableAt=now`.
- `claim`: raw CTE `FOR UPDATE SKIP LOCKED` sobre PENDING/FAILED o PROCESSING obsoleto
  (`locked_at < now()-lockTimeout`), orden `created_at ASC`.
- `markCompleted`/`markFailed` guardados por lease optimista (id + status PROCESSING + lockedBy +
  attemptCount).
- `markFailed`: dead-letter si `attemptCount >= maxAttempts`; backoff `min(3600, 2^min(attempt,10)*5)`s;
  error truncado a 4000 chars.
- `recordAndEnqueue`: crea el evento y luego un job por delivery, todo en la misma transacción.
- Dedup por `deduplication_key` único en ambas tablas.

## Componentes principales

| Componente | Tipo | Responsabilidad | Evidencia |
|---|---|---|---|
| `OutboxService` | Service | Fachada enqueue/claim/complete/fail | `outbox.service.ts` |
| `OutboxRepository` | Repository | Reclamo atómico, backoff, dead-letter, poda | `outbox.repository.ts` |
| `DomainEventPublisher` | Service | `record` / `recordAndEnqueue` | `domain-event.publisher.ts` |
| `OutboxMetricsService` | Service | Gauges Prometheus de cola | `outbox-metrics.service.ts` |
| `OutboxRetentionService` | Service | Poda de COMPLETED por antigüedad | `outbox-retention.service.ts` |
| `GymDomainEvent` (catálogo) | Const/Types | Tipos de evento + payloads tipados | `domain-event.catalog.ts` |

## Entidades y datos

Esquema `integration`: `OutboxJobModel` (outbox_jobs; queue/status/attempt, `deduplication_key`
único, payload JSONB, FK→DomainEvent), `DomainEventModel` (domain_events; log append-only,
`causation_event_id` self-FK, actor→User), `LegacyImportBatchModel` y `LegacyImportRecordModel`
(import legacy con contadores y fingerprint). Detalle: [[05-data/index]].

## Endpoints o contratos

Ninguno propio; métricas expuestas por [[03-domains/health/index]] (`/health/metrics`).

## Eventos

Catálogo `*.v1`: `customer.registered`, `staff.profile-created`, `staff.employment-status-changed`,
`membership.activated`, `membership.status-changed`, `equipment.assigned-to-room`,
`equipment.maintenance-scheduled/started/completed`, `access.decision-recorded`,
`notification.delivery-requested`. Cada uno con payload tipado en `GymDomainEventPayloadMap`.

## Dependencias

`DomainEventModel` FK→`UserModel`. Consumido por `notifications` (recordatorios), `access-control`,
`facilities`, `membership` y `health`. Los workers en `src/workers/*` conducen el ciclo.

## Autenticación y permisos

N/A (sin rutas expuestas).

## Manejo de errores

Updates condicionales con lease evitan doble-procesamiento (devuelven bool, no lanzan). Backoff +
intentos finitos + DEAD_LETTER. Dedup por índices únicos de BD.

## Transacciones y consistencia

Núcleo del módulo: el encolado ocurre dentro de la transacción del productor (`recordAndEnqueue`).
Reclamo con `FOR UPDATE SKIP LOCKED`; completado/fallo guardados por lease para procesamiento
exactly-processed pese a at-least-once en entrega.

## Procesamiento asíncrono

Consumidores: `notification-delivery.runner` (cola `notifications.delivery`) y `outbox-prune.command`
(retención). Ver [[07-async-processing/workers]].

## Observabilidad

Gauges `gym_sheet_outbox_jobs{queue,status}` y `gym_sheet_outbox_backlog_age_seconds{queue}`; clamp de
edad negativa (clock skew) a 0; escape de labels. Excluye COMPLETED por diseño.

## Pruebas

- `outbox-metrics.service.spec.ts` — cabeceras HELP/TYPE, gauges, estado vacío, clamp, escape.
- `outbox-retention.service.spec.ts` — dry-run, cálculo de cutoff, loop por lotes.
- `domain-event.publisher.spec.ts` — orden evento→deliveries; `record` solo no encola.

## Riesgos

- `ARCH-1` — Varios productores usan `record` (no `recordAndEnqueue`): sus eventos no se entregan
  salvo que algo poll-ee `domain_events`.
- Payload del job es JSONB no validado al encolar; los consumidores deben re-validar (notifications lo
  hace con Zod).
- Filas COMPLETED crecen sin límite hasta que se agende la poda externamente (sin cron interno).
- `recordAndEnqueue` encola deliveries secuencialmente (`for await`): muchas alargan la transacción
  (`INFERIDO` menor).

## Referencias al código

- `outbox.repository.ts` → `claim`, `markCompleted`, `markFailed`, `aggregateQueueMetrics`,
  `deleteCompletedBefore`.
- `domain-event.publisher.ts` → `record`, `recordAndEnqueue`.
- `outbox-metrics.service.ts` → `renderPrometheus`.
- `outbox-retention.service.ts` → `prune`.

## Relaciones

[[03-domains/notifications/index]] · [[03-domains/access-control/index]] · [[03-domains/health/index]] ·
[[03-domains/membership/index]] · [[03-domains/facilities/index]]
