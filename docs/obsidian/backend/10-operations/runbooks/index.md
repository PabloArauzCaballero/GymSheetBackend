---
type: runbook
status: verified
last_reviewed: 2026-08-06
source_revision: 27f3fd2
tags: [backend, operations, runbooks]
---

# Runbooks — índice

Procedimientos de respuesta a incidentes para el procesamiento asíncrono, integraciones y base de
datos. Cada runbook sigue la misma estructura: síntoma, impacto, severidad, señales, diagnóstico,
mitigación, recuperación, validación, rollback, escalamiento, prevención, referencias.

| Runbook | Cuándo | Severidad típica |
|---|---|---|
| [[worker-stopped]] | Un worker dejó de procesar / no arranca | alta |
| [[database-unavailable]] | PostgreSQL caído o inalcanzable | crítica |
| [[outbox-backlog]] | Backlog de cola creciente / dead-letters | alta |
| [[notification-gateway-down]] | Fallos de entrega de notificaciones | media-alta |
| [[failed-migration]] | La migración `migrate` falla o bloquea el arranque | crítica |

## Fuentes operativas reutilizadas

- `docs/operations/docker-and-messaging.md` (topología, escalado, diagnóstico, resiliencia).
- `docs/operations/observability-and-alerts.md` (métricas y alertas iniciales).
- `docs/operations/backup-restore-and-rollback.md` (backup/restore/rollback).

## Diagnóstico rápido común

```bash
docker compose ps                                   # estado de servicios
docker compose logs -f <servicio>                   # logs estructurados por 'event'
curl -s http://localhost:3001/api/v1/health/metrics | grep gym_sheet_outbox
docker compose exec postgres psql -U "$DB_USER" -d "$DB_NAME" -c \
  "SELECT queue_name, status, count(*) FROM integration.outbox_jobs GROUP BY 1,2;"
```

## Wikilinks

[[../health-checks]] · [[../../07-async-processing/retry-and-dead-letter]] · [[../deployment]]
