---
type: data
status: verified
last_reviewed: 2026-08-06
source_revision: 27f3fd2
tags: [backend, data]
---

# Inventario de almacenes

| Almacén | Tecnología | Tipo | Contenido | Durabilidad | Consumidores | Config |
|---|---|---|---|---|---|---|
| Base primaria | PostgreSQL 16 | Relacional (multi-esquema) | Todo el estado de negocio (44 tablas) | Durable, respaldado | API + 4 workers | `src/config/env.ts` (pool, statement_timeout) |
| Rate limiting | Redis (opcional) | Clave-valor efímero | Contadores de throttling | Volátil | API (guard de throttling) | `REDIS_URL`, `REDIS_REQUIRED` |
| Colas internas | PostgreSQL (tablas) | Cola transaccional | `integration.outbox_jobs`, `access_control.device_events` | Durable | Workers (claim `FOR UPDATE SKIP LOCKED`) | — |
| Historial de eventos | PostgreSQL (append-only) | Log inmutable | `integration.domain_events`, `membership.status_history` | Durable, trigger anti-mutación | Servicios y auditoría | — |
| Staging de importación | PostgreSQL | Tablas de staging idempotente | `integration.legacy_import_*` | Durable | Módulo integration | — |
| Estado de sync externo | PostgreSQL | Tabla de estado | `integration.exercise_dataset_sync_state` | Durable | worker exercises-dataset-refresh | — |
| Metadatos de media | PostgreSQL | Tabla | `media.files` (URLs, licencias) | Durable | membership/exercises | — |
| Gateway notificaciones | HTTP externo (WhatsApp) | Integración saliente | No almacena estado propio | N/A | worker notification-delivery | allowlist SSRF |

## Notas

- **PostgreSQL es la única fuente de verdad.** Redis y los gateways son periféricos y no deben
  contener estado que no se pueda reconstruir.
- **No hay broker de mensajería externo** (Kafka/RabbitMQ): la asincronía se resuelve con outbox +
  polling de workers (ADR-0005). Introducir una cola externa requiere ADR.
- **Esquemas PostgreSQL como fronteras de módulo:** `public`, `facilities`, `membership`,
  `access_control`, `notifications`, `integration`, `training`, `profile`, `media`.
- Los **binarios de media** (imágenes/GIF) viven en proveedores externos (URL en `media.files` /
  `exercise_media`), no en la base.

## Referencias

- [[data-architecture]] · [[transactions]] · [[physical-data-model]]
