---
type: data
status: verified
last_reviewed: 2026-08-06
source_revision: 27f3fd2
tags: [backend, data]
---

# Entidad: outbox-job

## Identidad
- **Tabla:** `integration.outbox_jobs` · **Modelo:** `src/modules/integration/outbox-job.model.ts`
- **PK:** `id` uuid v4

## Definición de negocio
Unidad de trabajo del **transactional outbox** (ADR-0005): representa un mensaje/efecto asíncrono que
debe entregarse tras un cambio de estado. Se escribe en la **misma transacción** que el cambio y su
`domain_event`, garantizando que no se pierde ni se emite de más.

## Clasificación
Cola · Dominio integration · Sensibilidad: media (el `payload` puede contener PII). Ver [[../sensitive-data]].

## Representaciones
- ORM: `OutboxJobModel` (`BelongsTo` domainEvent).

## Atributos
| Campo físico | Tipo | Req | Default | Restricción |
|---|---|---|---|---|
| id | uuid | Sí | uuid_v4 | PK |
| queue_name | varchar(120) | Sí | — | índice claim |
| event_type | varchar(160) | Sí | — | — |
| aggregate_type / aggregate_id | varchar/uuid | Sí/No | — | — |
| domain_event_id | uuid | No | — | FK domain_events RESTRICT |
| deduplication_key | varchar(240) | Sí | — | UNIQUE |
| payload | jsonb | Sí | — | CHECK jsonb_typeof=object |
| status | varchar(30) | Sí | PENDING | CHECK PENDING/PROCESSING/COMPLETED/FAILED/DEAD_LETTER |
| attempt_count / max_attempts | integer | Sí | 0 / 5 | CHECK max 1–20 |
| available_at | timestamptz | Sí | now() | backoff/visibilidad |
| locked_at / locked_by | timestamptz/varchar | No | — | claim de worker |
| processed_at | timestamptz | No | — | — |
| last_error | text | No | — | sin secretos |
| trace_id | varchar(128) | No | — | correlación |

## Invariantes
- `deduplication_key` UNIQUE → idempotencia (mismo efecto no se encola dos veces).
- `payload` debe ser objeto JSON.
- `max_attempts` entre 1 y 20; `attempt_count ≥ 0`.

## Relaciones
- N:1 → domain-event (RESTRICT, opcional). Ver [[../relationship-catalog]] R59.

## Estados
PENDING → PROCESSING → COMPLETED | FAILED → (PENDING backoff | DEAD_LETTER). VERIFICADO por CHECK;
transiciones por patrón de worker (INFERIDO). Ver [[../state-and-lifecycle-models]].

## CRUD
- C: en la transacción del productor. U: worker actualiza status/lock/attempts. R: claim con
  `FOR UPDATE SKIP LOCKED`. D: poda/retención (comandos de mantenimiento) para COMPLETED antiguos.

## Eventos
Es el mecanismo de entrega de los `domain_event`; no emite eventos propios.

## Sensibilidad
Media: `payload` y `last_error` podrían contener datos; no volcarlos completos en logs.

## Índices
- UK `deduplication_key`; `ix_outbox_claim (queue_name, status, available_at, created_at)`;
  `ix_outbox_domain_event (domain_event_id) WHERE NOT NULL`.

## Riesgos
- **DATA:** sin retención/poda, la tabla crece indefinidamente (existen servicios de retención/prune,
  ver `src/workers/outbox-prune.command.ts`).
- Entrega *at-least-once*: el consumidor externo debe ser idempotente.

## Evidencia
Migración `202607190002` (tabla + claim index); `202607190006` (FK domain_event); `outbox-job.model.ts`;
enum `QueueItemStatus`; ADR-0005.

## Relaciones (wikilinks)
[[entities/notification|notification]] · [[../transactions]] · [[../state-and-lifecycle-models]] ·
[[03-domains/integration/index|Dominio Integration]]
