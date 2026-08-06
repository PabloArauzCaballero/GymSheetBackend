---
title: "Referencia — Catálogo de eventos"
type: reference
status: verified
last_reviewed: "2026-08-06"
source_revision: "27f3fd2"
tags: [backend, reference, events]
related: ["[[07-async-processing/events]]"]
---

# Catálogo de eventos

> Patrón **transactional outbox** (ADR-0005). Escritura atómica del cambio de estado + registro del evento en la misma transacción. Ver [[07-async-processing/events]] y [[05-data/transactions]].

## Colas / spines

| Cola (tabla) | Schema | Productor | Consumidor | Garantía | DLQ |
|---|---|---|---|---|---|
| `outbox_jobs` | `integration` | `DomainEventPublisher.recordAndEnqueue` | **worker-notifications** (`notifications.delivery`) | exactly-once lógico (dedup key) | `DEAD_LETTER` al superar `max_attempts` |
| `device_events` | `access_control` | dispositivos/mock access | **worker-access** | at-least-once + lease | backoff, estado failed |
| `domain_events` | `integration` | `DomainEventPublisher.record` | — (solo historial/auditoría) | persistencia | — |

## Nota crítica

Solo `notifications.delivery` se **encola** hoy. `membership`, `staff`, `equipment` y `access-decision` usan `record()` → persisten en `domain_events` pero **no encolan** a `outbox_jobs`. `confirmIntent` (renovación) no registra evento ni historial (AUD-01). Ver [[14-audits/risks-register]] y [[14-audits/contradictions]] DOC-05.

## Mecánica

- Claim: `SELECT ... FOR UPDATE SKIP LOCKED` + `locked_by` + `attempt_count`.
- Backoff: `min(3600, 2^n·5)s` (outbox) / `min(300, 2^n·2)s` (access).
- Idempotencia: `deduplication_key` UNIQUE.
- Poda: comando opt-in `db:outbox:prune` (solo `COMPLETED`, dry-run por defecto).

Ver [[05-data/state-and-lifecycle-models]] · [[07-async-processing/retry-and-dead-letter]].
