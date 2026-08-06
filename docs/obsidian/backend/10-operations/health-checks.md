---
type: operations
status: verified
last_reviewed: 2026-08-06
source_revision: 27f3fd2
tags: [backend, operations, health]
---

# Health checks

Detalle de señales y alertas: `docs/operations/observability-and-alerts.md` y
[[../09-observability/health-checks]] / [[../09-observability/metrics]].

## Endpoints

| Endpoint | Qué comprueba | Semántica |
|---|---|---|
| `GET /health/live` | Liveness, **sin dependencias** | Siempre 200 si el proceso vive |
| `GET /health/ready` | Readiness: PostgreSQL alcanzable + migraciones aplicadas + Redis (si configurado) | 503 si el esquema está desactualizado o Redis configurado cae |
| `GET /health/metrics` | Métricas Prometheus (HTTP + cola outbox) | Protegible con `METRICS_SCRAPE_TOKEN` |

Regla clave: **readiness nunca dispara reinicios**. El healthcheck de Docker usa solo `/health/live`,
porque reiniciar un contenedor durante una caída de dependencia empeoraría el incidente.

## En Docker (`docker-compose.yml`)

| Servicio | Check |
|---|---|
| `api` | `curl` a `/health/live` (HEALTHCHECK del Dockerfile) |
| `postgres` | `pg_isready` (gate de dependientes) |
| `redis` | `redis-cli ping` (gate de dependientes) |
| workers | **deshabilitado** (sin HTTP; liveness = política de restart) |

## Métricas de cola (para health de async)

- `gym_sheet_outbox_jobs{queue,status}` (PENDING/PROCESSING/FAILED/DEAD_LETTER).
- `gym_sheet_outbox_backlog_age_seconds{queue}`.

Leídas en vivo de `integration.outbox_jobs` por scrape; `COMPLETED` no se cuenta (evita full-scan,
ADR-0005). Runbooks: [[runbooks/database-unavailable]], [[runbooks/outbox-backlog]],
[[runbooks/worker-stopped]].

## Wikilinks

[[../09-observability/health-checks]] · [[../09-observability/metrics]] · [[startup-shutdown]]
