---
type: async-processing
status: verified
last_reviewed: 2026-08-06
source_revision: 27f3fd2
tags: [backend, async, retry, dead-letter]
---

# Reintentos y dead-letter

Reintentos **finitos** con backoff exponencial; agotados los intentos, el trabajo queda en
`DEAD_LETTER` para triage humano. Nunca se pierde ni se reintenta infinito.

## Máximo de intentos

- **Outbox** (`notifications.delivery`): `job.maxAttempts` (columna `max_attempts`, default 5 en
  `enqueue`). `WORKER_MAX_ATTEMPTS` (default 5, rango 1–20) actúa como límite del worker.
- **Access queue** (`access_control.device_events`): `WORKER_MAX_ATTEMPTS` (default 5).

`attempt_count` se incrementa en el `claim` (`attempt_count = attempt_count + 1`). Se marca
`DEAD_LETTER` cuando `attempt_count >= max_attempts`.

## Backoff exponencial (en `available_at`)

| Cola | Fórmula (segundos) | Tope |
|---|---|---|
| Outbox (`markFailed`) | `min(3600, 2^min(intento,10) · 5)` | **3600 s (1 h)** |
| Access (`markEventFailed`) | `min(300, 2^min(intento,8) · 2)` | **300 s (5 min)** |

Al fallar, el `UPDATE` fija `status='FAILED'` (o `DEAD_LETTER`), limpia el lease (`locked_at`/
`locked_by=null`) y empuja `available_at` hacia el futuro. El `claim` solo toma filas con
`available_at <= now()`, así el backoff se respeta sin timers en memoria.

## Transición a DEAD_LETTER

`markFailed`/`markEventFailed` devuelven `{ deadLetter, updated }`. Para notificaciones, si
`updated` es cierto, `NotificationDeliveryService.recordFailure` crea un `delivery_attempt`
(`provider:'UNAVAILABLE'`, `status:FAILED`) y pone la notificación en `DEAD_LETTER` o `FAILED` según
corresponda. Estados en [[../05-data/state-and-lifecycle-models]].

## Observabilidad y alertas

- `gym_sheet_outbox_jobs{queue,status="FAILED"}` — reintentos en vuelo.
- `gym_sheet_outbox_jobs{queue,status="DEAD_LETTER"}` — agotados, requieren humano (alerta > 0).
- `gym_sheet_outbox_backlog_age_seconds{queue}` — antigüedad del más viejo pendiente/fallido.
- Logs: `notification_delivery.failed` / `access_event.failed` con `deadLetter`, `attempt`,
  `leaseUpdated`, `errorName`.

Inspección directa de la DLQ y runbook: [[../10-operations/runbooks/outbox-backlog]] y
`docs/operations/docker-and-messaging.md` (§Diagnostics, §Resilience testing). El estado
`DEAD_LETTER` **no** es elegible para la poda de retención ([[batch-jobs]]).

## Wikilinks

[[queues]] · [[idempotency]] · [[ordering-and-concurrency]] · [[../09-observability/metrics]]
