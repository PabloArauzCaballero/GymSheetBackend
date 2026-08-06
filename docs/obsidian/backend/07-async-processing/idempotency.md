---
type: async-processing
status: verified
last_reviewed: 2026-08-06
source_revision: 27f3fd2
tags: [backend, async, idempotency]
---

# Idempotencia

La entrega es **at-least-once**, por lo que la corrección depende de que encolado y handlers sean
idempotentes. Mecanismos verificados en código:

## 1. Encolado idempotente — `deduplication_key`

`integration.outbox_jobs.deduplication_key` es **UNIQUE**. Un segundo encolado con la misma clave
lanza `UniqueConstraintError`. En el scan de reminders esto se cuenta como `duplicates` y se continúa
(no es error). Claves construidas de forma determinista, p. ej.
`membership-expiry:{membershipId}:{endsOn}:{daysRemaining}:{channel}` y `delivery:{key}`
(`membership-reminder.service.ts`). El evento de dominio también tiene su `deduplication_key` único.

Regla de arquitectura: los conflictos de unicidad se traducen a `ConflictException` (409), no a 500
(`.claude/rules/10-backend-architecture.md`).

## 2. Ack exactly-once lógico — lease check

`markCompleted` / `markFailed` (outbox) y `completeClaimedEvent` / `markEventFailed` (access) hacen un
`UPDATE` condicionado por `id` + `status='PROCESSING'` + `locked_by=workerId` + `attempt_count`. Si
otro worker robó el lease (o cambió el intento), el `UPDATE` afecta 0 filas y devuelve `updated=false`
→ se registra `lease_lost_after_delivery` sin corromper el estado.

## 3. Handlers idempotentes

- **Entrega de notificaciones** (`NotificationDeliveryService.deliver`): si la notificación ya está
  `SENT`/`READ`, retorna sin reenviar. Reenvía solo estados no terminales. Reserva el
  `idempotencyKey = job.deduplication_key` al gateway (cabecera `X-Idempotency-Key`).
- **Procesamiento de acceso** (`access-control.service.processEvent`): si ya existe una decisión para
  el evento, completa/rechaza el lease sin recalcular (dedup por decisión existente).
- **Importación de dataset**: upsert por `(dataSource, externalId)`; reimportar el mismo snapshot es
  no-op (`unchangedSnapshot` por `contentSha256`). Ver [[batch-jobs]].

## 4. Poda de outbox

Solo borra `COMPLETED`; re-ejecutarla es seguro e idempotente. Ver [[batch-jobs]].

## Wikilinks

[[retry-and-dead-letter]] · [[ordering-and-concurrency]] · [[queues]] ·
[[../05-data/state-and-lifecycle-models]]
