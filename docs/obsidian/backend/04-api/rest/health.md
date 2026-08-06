---
title: "REST · Health y Gateway"
type: api
status: verified
last_reviewed: "2026-08-06"
source_revision: "27f3fd2"
tags: [backend, api]
---

# REST · Health y Gateway

Controladores: `src/modules/health/health.controller.ts`
(`@Public()`, `@SkipThrottle()`) y `src/gateway/gateway.controller.ts`
(`@Public()`). Servicios: `health.service.ts`, `gateway.service.ts`. Guard de
métricas: `metrics-scrape.guard.ts`.

`health/*` está en `docs/endpoints/openapi-observability.yaml` (no en
`openapi.yaml`); `gateway/*` sí está en `openapi.yaml`.

## Health — `@Controller('health')`

| Método | Ruta | Auth | Propósito |
|---|---|---|---|
| GET | `/health/live` | Público | Liveness sin dependencias (siempre 200 si el proceso vive) |
| GET | `/health/ready` | Público | Readiness: PostgreSQL + estado de migraciones + Redis; **503** si el esquema está desactualizado o Redis configurado está caído |
| GET | `/health/metrics` | Público* | Prometheus (`text/plain; version=0.0.4`); HTTP + memoria + pool + métricas de outbox |

- `@SkipThrottle()`: las sondas nunca dependen del rate limiter — ver
  [[04-api/rate-limits]].
- `/health/metrics`: `MetricsScrapeGuard` — si `METRICS_SCRAPE_TOKEN` está fijado
  exige `Authorization: Bearer <token>` (comparación en tiempo constante,
  `timingSafeEqual`); si no, queda abierto y se espera restricción de red. El payload
  expone topología/tráfico, por eso se recomienda protegerlo.
- El interceptor no envuelve `text/plain` (salida Prometheus cruda).

## Gateway — `@Controller('gateway')` (`src/gateway`)

| Método | Ruta | Auth | Propósito |
|---|---|---|---|
| GET | `/gateway/health` | Público | Liveness de compatibilidad (`{ status, service, checkedAt }`) |
| GET | `/gateway/routes` | Público | Resumen de capacidades no sensible (`version: v1`, lista de módulos) — sin detalle de rutas privilegiadas |

`GATEWAY_ENABLED` (def. true) controla el montaje del módulo gateway.

Relacionado: [[04-api/rate-limits]] · [[04-api/error-model]] · [[04-api/versioning]]
