---
title: "Tracing"
type: observability
status: inferred
criticality: medium
last_reviewed: "2026-08-06"
source_revision: "27f3fd2"
source_files:
  - "src/modules/integration/domain-event.model.ts"
  - "src/common/middleware/request-id.middleware.ts"
tags: [backend, observability, tracing, inferred]
---

# Tracing

> **INFERIDO / pendiente.** No se observa tracing distribuido (OpenTelemetry, Jaeger, Zipkin) en el
> código revisado. No hay instrumentación de spans ni exportador de trazas.

## Estado actual (VERIFICADO)

Lo que existe es **correlación**, no tracing distribuido:

- **`requestId`** por petición (`request-id.middleware.ts`), presente en logs y respuestas de error.
  Ver [[09-observability/correlation-ids]].
- **`correlation_id`, `causation_event_id`, `trace_id`** como columnas en
  `integration.domain_events` (`domain-event.model.ts:50-57`). Permiten encadenar eventos de dominio
  y, potencialmente, ligarlos a una traza externa, pero **no** hay propagación de contexto de traza
  entre servicios ni generación de spans en el código revisado.

## Brecha

- Sin tracing distribuido, el diagnóstico entre API → workers → gateways externos se apoya en la
  correlación por `requestId`/`correlation_id` y en los logs estructurados, no en un árbol de spans.

## Recomendación (INFERIDO)

Si se requiere trazabilidad extremo a extremo, evaluar OpenTelemetry con propagación de
`trace_id` reutilizando los campos ya presentes en `domain_events`. Cualquier adopción de una
librería de tracing requiere ADR (regla `70-library-selection.md`).

Relacionado: [[09-observability/correlation-ids]] · [[08-security/audit-trail]] · [[09-observability/observability-overview]].
