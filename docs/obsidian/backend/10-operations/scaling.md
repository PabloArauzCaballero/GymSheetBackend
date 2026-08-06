---
type: operations
status: verified
last_reviewed: 2026-08-06
source_revision: 27f3fd2
tags: [backend, operations, scaling]
---

# Escalado

Detalle operativo en `docs/operations/docker-and-messaging.md` (§Horizontal scaling). Resumen:

## Workers (escalado horizontal sin cambio de código)

Los workers son consumidores **stateless**. `FOR UPDATE SKIP LOCKED` garantiza que dos réplicas nunca
reclaman el mismo job, así que escalar es directo:

```bash
docker compose up -d --scale worker-notifications=3 --scale worker-access=2
```

- No publican puertos y su healthcheck está deshabilitado → cualquier número de réplicas es válido.
- Dimensionar contra `gym_sheet_outbox_backlog_age_seconds` y las métricas del pool
  (`gym_sheet_database_pool_connections`). **No** escalar workers más allá de lo que `DB_POOL_MAX` y
  la base puedan absorber.
- Palancas por proceso: `WORKER_CONCURRENCY` (paralelismo dentro del lote) y `WORKER_BATCH_SIZE`
  (prefetch). Ver [[../07-async-processing/ordering-and-concurrency]].

## API (limitada por el puerto publicado)

El servicio `api` mapea un puerto de host fijo, así que `--scale api=N` falla mientras exista ese
mapeo. Para varias réplicas: quitar el mapeo y poner un reverse proxy en la red de Compose. El Redis
compartido ya hace correcto el rate limiting entre réplicas (`REDIS_URL` + `REDIS_REQUIRED=true`).

## Límite de reevaluación (ADR-0005)

El outbox sobre PostgreSQL basta para el volumen real (eventos por minuto). Se reevalúa (posible
`LISTEN/NOTIFY` o broker) solo si, con evidencia medida: backlog `PENDING` sostenido que el polling
no drena aun escalando; necesidad de latencia sub-segundo; fan-out heterogéneo/streaming; o el
`claim` compite dañinamente con el OLTP. Ver
[ADR-0005](../../../decisions/ADR-0005-messaging-transactional-outbox.md).

## Wikilinks

[[deployment]] · [[health-checks]] · [[../07-async-processing/queues]] ·
[[../07-async-processing/ordering-and-concurrency]]
