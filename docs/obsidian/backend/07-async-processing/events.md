---
type: async-processing
status: verified
last_reviewed: 2026-08-06
source_revision: 27f3fd2
tags: [backend, async, events, outbox]
---

# Eventos de dominio y outbox transaccional

Patrón: **transactional outbox** (ADR-0005). Un servicio de dominio, dentro de **una** transacción
Sequelize, cambia el estado de negocio y — en el mismo `COMMIT` — registra el evento de dominio y
(opcionalmente) encola el trabajo derivado. Sin doble escritura, sin mensaje perdido en la frontera.

```text
servicio de dominio (transacción)
  → domain_events (INSERT)                    ── DomainEventPublisher.record
  → outbox_jobs   (INSERT, mismo COMMIT)      ── DomainEventPublisher.recordAndEnqueue → OutboxService.enqueue
  → worker: claim FOR UPDATE SKIP LOCKED → handler idempotente → COMPLETED | FAILED | DEAD_LETTER
```

## Dos caminos

- **`record(input, tx)`** — inserta solo en `integration.domain_events` (historial/auditoría con
  `event_version`, `correlation_id`, `causation_event_id`, `trace_id`, `payload`, `metadata`). **No**
  produce entrega.
- **`recordAndEnqueue(input, deliveries[], tx)`** — inserta el evento y **N** jobs de outbox
  (una por `delivery`), enlazados por `domain_event_id`.

## Catálogo de eventos (`domain-event.catalog.ts`)

Todos versionados `.v1`. Payloads tipados en `GymDomainEventPayloadMap`.

| Evento | Productor | ¿Encola? | Consumidor | Garantía |
|---|---|---|---|---|
| `notification.delivery-requested.v1` | `MembershipReminderService` | **Sí** → `notifications.delivery` | `worker-notifications` | at-least-once + dedup |
| `access.decision-recorded.v1` | `access-control.service` | No (`record`) | — (solo historial) | registro atómico |
| `membership.activated.v1` | `membership.service` | No (`record`) | — | registro atómico |
| `membership.status-changed.v1` | `membership.service` | No (`record`) | — | registro atómico |
| `customer.registered.v1` | `customer-staff.service` (INFERIDO) | No (`record`) | — | registro atómico |
| `staff.profile-created.v1` | `customer-staff.service` (INFERIDO) | No (`record`) | — | registro atómico |
| `staff.employment-status-changed.v1` | `customer-staff.service` (INFERIDO) | No (`record`) | — | registro atómico |
| `equipment.assigned-to-room.v1` | `facilities.service` (INFERIDO) | No (`record`) | — | registro atómico |
| `equipment.maintenance-scheduled.v1` | `facilities.service` (INFERIDO) | No (`record`) | — | registro atómico |
| `equipment.maintenance-started.v1` | `facilities.service` (INFERIDO) | No (`record`) | — | registro atómico |
| `equipment.maintenance-completed.v1` | `facilities.service` (INFERIDO) | No (`record`) | — | registro atómico |

> **VERIFICADO:** a esta revisión el **único** evento con consumidor de outbox es
> `notification.delivery-requested.v1`. Los demás se registran para historial/proyecciones futuras.
> Los `queueName` `customer.projections` / `customer.audit-export` aparecen solo en pruebas del
> publisher, no en servicios de producción (INFERIDO: reservados para proyecciones futuras).

## DLQ (dead-letter)

Un job supera `max_attempts` → `status='DEAD_LETTER'`, se detiene el reintento y queda para triage
humano. Para notificaciones, `NotificationDeliveryService.recordFailure` marca además la notificación
como `DEAD_LETTER`. Ver [[retry-and-dead-letter]].

## Reintento

Backoff exponencial en `available_at` (ver [[retry-and-dead-letter]]). El encolado en sí es
idempotente por `deduplication_key` (unique); un segundo encolado con la misma clave produce
`UniqueConstraintError` → se traduce a 409/ruta idempotente. Ver [[idempotency]].

## Wikilinks

[[../03-domains/integration/index]] · [[../03-domains/notifications/index]] ·
[[../05-data/state-and-lifecycle-models]] · [[queues]]
