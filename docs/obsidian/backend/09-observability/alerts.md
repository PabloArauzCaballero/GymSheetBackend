---
title: "Alertas"
type: observability
status: verified
criticality: high
last_reviewed: "2026-08-06"
source_revision: "27f3fd2"
source_files:
  - "docs/operations/observability-and-alerts.md"
  - "src/common/metrics/http-metrics.service.ts"
  - "src/modules/integration/outbox-metrics.service.ts"
tags: [backend, observability, alerts]
---

# Alertas

> Las condiciones son **puntos de partida seguros, no facto de producción**. Deben ajustarse tras
> observar tráfico e infraestructura reales. Fuente: `docs/operations/observability-and-alerts.md`
> → [[10-operations/observability-and-alerts]].

## Propuestas iniciales (VERIFICADO en runbook)

| Alerta | Condición inicial | Ventana | Severidad |
|---|---|---|---|
| API no disponible | readiness falla | 2 min | crítica |
| Tasa 5xx elevada | 5xx/total > 2% con ≥ 20 req | 5 min | alta |
| Latencia de lectura | p95 > 800 ms en rutas de lectura | 10 min | warning |
| Latencia de escritura | p95 > 1.4 s en escritura de workouts | 10 min | warning |
| Saturación de pool | `waiting > 0` o `using/size > 0.9` | 5 min | alta |
| Presión de memoria | RSS > 80% del límite del contenedor | 10 min | alta |
| Guarda de cardinalidad activa | `..._series_dropped_total` aumenta | 5 min | warning |
| Fallo de conector | `exercises_dataset.refresh_failed` | 3 intentos | warning |
| Caché de dataset obsoleta | último checkpoint > 26 h | 15 min | alta |
| Backlog de cola creciendo | `gym_sheet_outbox_backlog_age_seconds > 300` | 10 min | alta |
| Dead-letter presente | `gym_sheet_outbox_jobs{status="DEAD_LETTER"} > 0` | 5 min | alta |
| Worker estancado | `PROCESSING > 0` sin cambio mientras sube el backlog | 10 min | alta |

## Señales de origen

- Métricas HTTP y de outbox: [[09-observability/metrics]].
- Readiness/liveness: [[09-observability/health-checks]].
- Logs estructurados (`event`) para throughput de workers y fallos de dataset:
  [[09-observability/logging]].

## Flujo de incidente (runbook)

```txt
Alerta → verificar readiness y despliegues recientes → error rate y latencia
       → pool y memoria → correlacionar por requestId → mitigar o rollback
       → preservar evidencia → documentar causa raíz y acción correctiva
```

Regla operativa: **no** aumentar pool/timeouts/memoria como primera respuesta sin identificar el
cuello de botella (oculta saturación).

## Brechas

- Sin SLO formal, las severidades y ventanas son heurísticas iniciales; ver
  [[09-observability/slo-sli-sla]] (INFERIDO/pendiente).
- No se observa configuración de alerting como código (Alertmanager, etc.) en el repositorio; las
  alertas viven como propuestas en el runbook (INFERIDO).

Relacionado: [[10-operations/observability-and-alerts]] · [[09-observability/metrics]].
