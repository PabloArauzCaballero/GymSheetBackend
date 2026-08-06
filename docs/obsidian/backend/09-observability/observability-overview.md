---
title: "Observabilidad — Visión general"
type: observability
status: verified
criticality: high
last_reviewed: "2026-08-06"
source_revision: "27f3fd2"
source_files:
  - "src/main.ts"
  - "src/workers/worker-bootstrap.ts"
  - "src/modules/health/health.controller.ts"
  - "src/common/metrics/http-metrics.service.ts"
  - "docs/operations/observability-and-alerts.md"
tags: [backend, observability, overview]
---

# Observabilidad — Visión general

Los tres pilares en este backend: **logs estructurados**, **métricas Prometheus** y **health checks**.
No hay tracing distribuido implementado (ver [[09-observability/tracing]], INFERIDO).

## Señales disponibles (VERIFICADO)

| Pilar | Mecanismo | Nota |
|---|---|---|
| Logs | Objetos estructurados con `event`, `requestId` | [[09-observability/logging]] |
| Correlación | `request-id.middleware.ts` (saneado); `correlation_id`/`trace_id` en domain_events | [[09-observability/correlation-ids]] |
| Métricas | Prometheus en `/health/metrics` (HTTP + outbox) | [[09-observability/metrics]] |
| Health | `/health/live` y `/health/ready` | [[09-observability/health-checks]] |
| Alertas | Propuestas en runbook de operaciones | [[09-observability/alerts]] |
| SLO/SLI/SLA | No formalizados | [[09-observability/slo-sli-sla]] (INFERIDO/pendiente) |

## Topología observada

- **API HTTP**: emite logs de arranque (`application.started`), sirve `/health/*` y métricas.
- **Workers** (access-event, membership-reminder, notification-delivery, exercises-dataset-refresh):
  procesos separados sin HTTP. **Vuelcan sus logs** con `flushLogs()` en el bootstrap
  (`worker-bootstrap.ts:16`) — corrección de F-015; sin ella eran inobservables. Emiten
  `worker.started` y `worker.shutdown_requested`.
- **Outbox**: profundidad y antigüedad de backlog expuestas como métricas leídas en vivo de la DB.

## Principios (regla `40-observability.md`)

- Logs estructurados con `event` y correlation ID; sin secretos ni PII.
- Redacción de 5xx en producción.
- Health real: liveness sin dependencias; readiness verifica PostgreSQL + estado de migraciones +
  Redis. Las sondas nunca dependen del backend de rate limiting (`@SkipThrottle` en health).
- Los workers deben volcar sus logs (verificado).
- Métricas protegibles con `METRICS_SCRAPE_TOKEN`.

## Brechas

- Sin tracing distribuido (solo campos `trace_id`/`correlation_id` en el rastro de eventos).
- SLO/SLI/SLA no formalizados; los umbrales de alerta son puntos de partida, no facto.
- Retención de logs propuesta (30/90 días) pendiente de aprobación.

Relacionado: [[10-operations/observability-and-alerts]] · [[08-security/audit-trail]].
