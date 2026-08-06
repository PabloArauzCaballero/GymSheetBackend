---
title: "SLO / SLI / SLA"
type: observability
status: inferred
criticality: medium
last_reviewed: "2026-08-06"
source_revision: "27f3fd2"
source_files:
  - "docs/operations/observability-and-alerts.md"
  - "src/common/metrics/http-metrics.service.ts"
tags: [backend, observability, slo, inferred]
---

# SLO / SLI / SLA

> **INFERIDO / pendiente.** No hay SLO/SLI/SLA formalizados en el repositorio. Este documento propone
> un punto de partida basado en las señales ya disponibles; **debe aprobarse** contra objetivos de
> negocio y capacidad real antes de comprometerse a un SLA.

## SLI candidatos (medibles hoy — VERIFICADO que la señal existe)

| SLI | Fuente | Métrica |
|---|---|---|
| Disponibilidad | Readiness/liveness | fallos de readiness (ver [[09-observability/health-checks]]) |
| Tasa de éxito de peticiones | HTTP metrics | `1 - (5xx/total)` desde `gym_sheet_http_requests_total` |
| Latencia | Histograma | p50/p95/p99 de `gym_sheet_http_request_duration_seconds` |
| Frescura de trabajo asíncrono | Outbox | `gym_sheet_outbox_backlog_age_seconds` |
| Salud de cola | Outbox | `gym_sheet_outbox_jobs{status="DEAD_LETTER"}` = 0 |

## SLO propuestos (INFERIDO — NO comprometidos)

- Disponibilidad de API: objetivo a definir (p. ej. 99.5% mensual) — **pendiente**.
- Éxito de peticiones: > 99% (coherente con la alerta de 5xx > 2%).
- Latencia p95: lectura < 800 ms, escritura < 1.4 s (coherente con [[09-observability/alerts]]).
- Backlog de outbox: p95 de antigüedad < 300 s.

Estos valores derivan de las **propuestas de alerta** del runbook, que el propio documento marca como
"safe starting points, not production facts".

## SLA

- **No existe SLA contractual** documentado. Un SLA requiere acuerdo de negocio y presupuesto de error
  aprobado; fuera del alcance del código.

## Requisito para formalizar

1. Establecer baseline con tráfico real (p50/p95/p99) — existe `test/load/http-load-smoke.mjs` con
   presupuesto para medir (regla `50-performance.md`).
2. Definir ventana y presupuesto de error.
3. Aprobar SLO y, si aplica, SLA.

Relacionado: [[09-observability/alerts]] · [[09-observability/metrics]] · [[09-observability/health-checks]].
