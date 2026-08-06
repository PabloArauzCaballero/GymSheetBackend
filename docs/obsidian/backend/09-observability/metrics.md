---
title: "Métricas"
type: observability
status: verified
criticality: high
last_reviewed: "2026-08-06"
source_revision: "27f3fd2"
source_files:
  - "src/modules/health/health.controller.ts"
  - "src/modules/health/metrics-scrape.guard.ts"
  - "src/common/metrics/http-metrics.service.ts"
  - "src/modules/integration/outbox-metrics.service.ts"
  - "docs/operations/observability-and-alerts.md"
tags: [backend, observability, metrics, prometheus]
---

# Métricas

## Endpoint (VERIFICADO)

`GET /api/v1/health/metrics` — formato Prometheus texto (`version=0.0.4`)
(`health.controller.ts:35-44`). Combina métricas HTTP y de outbox en una sola respuesta.

### Protección

- `MetricsScrapeGuard`: si `METRICS_SCRAPE_TOKEN` está definido, exige `Authorization: Bearer <token>`
  comparado en **tiempo constante** (`timingSafeEqual`) (`metrics-scrape.guard.ts`). Si el token no
  está definido, el endpoint queda **abierto** en la capa de routing y debe restringirse por red.
- Ver la brecha SEC-1 en [[08-security/security-findings]].

## Series expuestas (VERIFICADO)

Fuente `http-metrics.service.ts` y `outbox-metrics.service.ts`:

| Métrica | Tipo | Significado |
|---|---|---|
| `gym_sheet_process_uptime_seconds` | gauge | Vida del proceso (detectar reinicios) |
| `gym_sheet_process_resident_memory_bytes` | gauge | Memoria residente |
| `gym_sheet_node_heap_used_bytes` | gauge | Heap V8 usado |
| `gym_sheet_database_pool_connections{state}` | gauge | Pool: size/available/using/waiting |
| `gym_sheet_http_requests_total{method,route,status}` | counter | Peticiones completadas |
| `gym_sheet_http_request_duration_seconds` | histogram | Latencia (buckets 0.05–5 s) |
| `gym_sheet_http_metric_series_dropped_total` | counter | Series rechazadas por el límite de cardinalidad |
| `gym_sheet_outbox_jobs{queue,status}` | gauge | Jobs de outbox por cola y estado |
| `gym_sheet_outbox_backlog_age_seconds{queue}` | gauge | Antigüedad del job pendiente más viejo |

## Diseño defensivo (VERIFICADO)

- **Cardinalidad acotada**: máximo 250 series HTTP; método/ruta truncados; labels escapados. Nuevas
  series por encima del límite se descartan y se cuentan en `..._series_dropped_total`
  (`http-metrics.service.ts:44-49,92-94`).
- **Sin datos sensibles**: el registro **nunca** almacena cuerpos, query params, tokens, emails ni
  identificadores de usuario (`observability-and-alerts.md` §27).
- **Outbox en vivo**: profundidad de cola leída de `integration.outbox_jobs` en cada scrape; solo
  estados accionables (COMPLETED es append-only y no se cuenta, ADR-0005).

## Brechas

- Métrica opt-in a token; sin token queda expuesta si no hay restricción de red (SEC-1).
- No hay exportador push ni pull hacia un backend externo definido en código; depende del scraping.

Relacionado: [[09-observability/alerts]] · [[10-operations/observability-and-alerts]] · [[09-observability/health-checks]].
