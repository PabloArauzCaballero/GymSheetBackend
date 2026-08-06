---
type: async-processing
status: verified
last_reviewed: 2026-08-06
source_revision: 27f3fd2
tags: [backend, async, queues, outbox]
---

# Colas (outbox en base de datos)

No hay broker externo (RabbitMQ/Kafka/Redis Streams). La cola es una **tabla PostgreSQL**:
`integration.outbox_jobs` (`OutboxJobModel`). El desacoplamiento productor/consumidor y la
durabilidad viven en la misma base transaccional. Decisión y alternativas descartadas:
[ADR-0005](../../../decisions/ADR-0005-messaging-transactional-outbox.md).

## Estructura de `integration.outbox_jobs`

| Columna | Rol |
|---|---|
| `queue_name` | Separa colas lógicas por tipo (`STRING(120)`) |
| `event_type`, `aggregate_type`, `aggregate_id` | Origen del trabajo |
| `domain_event_id` | FK al `domain_events` que lo originó (nullable) |
| `deduplication_key` | **UNIQUE** — idempotencia de encolado |
| `payload` | JSONB con datos del handler |
| `status` | `PENDING`→`PROCESSING`→`COMPLETED`/`FAILED`/`DEAD_LETTER` |
| `attempt_count`, `max_attempts` | Reintentos finitos (default 5) |
| `available_at` | Momento en que el job es elegible (base del backoff) |
| `locked_at`, `locked_by` | Lease del worker que lo reclama |
| `processed_at`, `last_error`, `trace_id` | Auditoría / correlación |

Índice de rendimiento: `ix_outbox_claim (queue_name, status, available_at, created_at)` — no relajar
sin medir (ADR-0005 §Costos).

## Colas activas

| Cola | Productor | Consumidor | Estado |
|---|---|---|---|
| `notifications.delivery` | `MembershipReminderService.scan` (`recordAndEnqueue`) | `worker-notifications` (`NotificationDeliveryRunner`) | **VERIFICADO** (único consumidor real de la tabla outbox) |
| `access_control.device_events` | Ingesta de eventos de dispositivo (adapter) | `worker-access` (`AccessEventRunner`) | **VERIFICADO** — tabla-cola separada, **no** es `outbox_jobs` pero usa el mismo patrón de claim |

> **INFERIDO / discrepancia con `docs/operations/docker-and-messaging.md`:** ese runbook lista
> también `access.decisions` y `membership.reminders` como colas. En el código a esta revisión:
> los eventos de acceso se procesan sobre la tabla `access_control.device_events` (no un
> `queue_name='access.decisions'`), y los recordatorios de membresía **producen** hacia
> `notifications.delivery` en vez de consumirse desde una cola propia. El worker de reminders es un
> **scheduler/productor**, no un consumidor de cola. Ver [[schedulers]].

## Eventos de dominio sin cola (solo registro)

Varios servicios (`membership.service`, `access-control.service`, `customer-staff.service`,
`facilities.service`) llaman `events.record(...)` — que **solo inserta en `integration.domain_events`**
(historial/auditoría) y **no encola** trabajo de entrega. Solo `MembershipReminderService` usa
`recordAndEnqueue`. Detalle en [[events]].

## Semántica de entrega

At-least-once con exactly-once **lógico** por lease check (`locked_by` + `attempt_count` en el
`UPDATE` condicional de `markCompleted`/`markFailed`), concurrencia y prefetch acotados
(`WORKER_CONCURRENCY`, `WORKER_BATCH_SIZE`), backoff exponencial, `DEAD_LETTER` al agotar intentos, e
idempotencia por `deduplication_key` único + handlers idempotentes. Ver [[idempotency]],
[[retry-and-dead-letter]], [[ordering-and-concurrency]].

## Retención

`COMPLETED` es append-only y crece sin límite; se poda con el comando opt-in `db:outbox:prune`
(dry-run por defecto). Ver [[batch-jobs]] y [[../10-operations/deployment]].
