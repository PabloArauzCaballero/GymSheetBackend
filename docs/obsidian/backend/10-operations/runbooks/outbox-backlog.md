---
type: runbook
status: verified
last_reviewed: 2026-08-06
source_revision: 27f3fd2
tags: [backend, operations, runbook, outbox]
---

# Runbook — backlog de outbox / dead-letters

- **Síntoma:** `gym_sheet_outbox_backlog_age_seconds` sube; crece `PENDING`/`FAILED`; aparecen
  `DEAD_LETTER`.
- **Impacto:** entregas demoradas (notificaciones tardías) o perdidas para triage (dead-letter). La
  API no se ve afectada.
- **Severidad:** alta.

## Señales

- `gym_sheet_outbox_jobs{queue,status="PENDING"|"FAILED"|"DEAD_LETTER"}`.
- `gym_sheet_outbox_backlog_age_seconds{queue} > 300` (alerta "Queue backlog growing").
- `gym_sheet_outbox_jobs{status="DEAD_LETTER"} > 0` (alerta "Dead-letter present").
- Logs `notification_delivery.failed` con `deadLetter=true`.

## Diagnóstico

```bash
curl -s http://localhost:3001/api/v1/health/metrics | grep gym_sheet_outbox
docker compose exec postgres psql -U "$DB_USER" -d "$DB_NAME" -c \
  "SELECT queue_name, status, count(*) FROM integration.outbox_jobs GROUP BY 1,2 ORDER BY 1,2;"
docker compose exec postgres psql -U "$DB_USER" -d "$DB_NAME" -c \
  "SELECT id, attempt_count, max_attempts, left(last_error,120) FROM integration.outbox_jobs \
   WHERE status='DEAD_LETTER' ORDER BY updated_at DESC LIMIT 20;"
```

Determinar la causa raíz del `last_error` (p. ej. gateway caído → [[notification-gateway-down]]).

## Mitigación

- Backlog `PENDING` por falta de capacidad: escalar workers
  (`--scale worker-notifications=3`), sin superar `DB_POOL_MAX`. Ver [[../scaling]].
- `FAILED` por dependencia externa: arreglar la dependencia; el backoff reintenta solo.
- `DEAD_LETTER`: requieren **triage humano**. No hay reintento automático. Reencolar (tras corregir
  la causa) es una acción manual/operativa (INFERIDO: no hay endpoint de re-drive a esta revisión).

## Recuperación

Restablecida la dependencia, los `FAILED` se reintentan al vencer su `available_at`. El backlog age
baja al drenar la cola.

## Validación

Backlog age decreciente; `DEAD_LETTER` estable o en 0; entregas confirmadas (`delivery_attempt`
`SENT`).

## Rollback

Si el pico coincide con un release, revertir según [[../rollback]].

## Escalamiento

`DEAD_LETTER` masivo o crecimiento imparable pese a escalar → escalar a Ingeniería; evaluar disparador
de reevaluación de ADR-0005 (backlog sostenido que el polling no drena).

## Prevención

- Alertas de backlog age y dead-letter (ya propuestas).
- Poda de retención periódica de `COMPLETED` (`db:outbox:prune`, [[../../07-async-processing/batch-jobs]])
  para que la tabla no crezca sin límite.
- Dimensionar `WORKER_CONCURRENCY`/`WORKER_BATCH_SIZE` a la carga.

## Referencias

[[../../07-async-processing/retry-and-dead-letter]] · [[../../07-async-processing/queues]] ·
[[notification-gateway-down]] · `docs/operations/observability-and-alerts.md` ·
`docs/operations/docker-and-messaging.md`
