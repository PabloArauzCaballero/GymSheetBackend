---
type: operations
status: verified
last_reviewed: 2026-08-06
source_revision: 27f3fd2
tags: [backend, operations, configuration]
---

# Configuración

Toda la configuración entra por **variables de entorno**, validadas y con defaults en
`src/config/env.ts` (Zod). Un valor inválido o un secreto faltante **falla el arranque** (fail-fast).
Solo `.env.example` se versiona; los valores reales nunca. Ver [[../08-security/secrets-management]].

> Referencia completa (tabla por variable): [[../15-reference/environment-variables]].

## Grupos relevantes para async/integraciones/ops

| Grupo | Variables clave |
|---|---|
| Workers / colas | `WORKER_POLL_INTERVAL_MS`, `WORKER_BATCH_SIZE`, `WORKER_CONCURRENCY`, `WORKER_LOCK_TIMEOUT_MS`, `WORKER_MAX_ATTEMPTS` |
| Retención outbox | `OUTBOX_RETENTION_DAYS`, `OUTBOX_PRUNE_BATCH_SIZE` |
| Recordatorios | `REMINDER_SCAN_INTERVAL_MS`, `BUSINESS_TIME_ZONE` |
| Gateway notificaciones | `NOTIFICATION_DELIVERY_PROVIDER`, `NOTIFICATION_GATEWAY_URL`, `NOTIFICATION_GATEWAY_SECRET`, `NOTIFICATION_GATEWAY_ALLOWED_HOSTS`, `NOTIFICATION_GATEWAY_TIMEOUT_MS`, `WHATSAPP_MEMBERSHIP_PHONE` |
| Dataset ejercicios | `EXERCISES_DATASET_*`, `EXERCISES_OPEN_MEDIA_*` |
| Base de datos | `DB_HOST/PORT/NAME/USER/PASSWORD`, `DB_SSL*`, `DB_POOL_*`, `DB_*_TIMEOUT_MS` |
| Rate limiting / Redis | `REDIS_URL`, `REDIS_REQUIRED`, `RATE_LIMIT_*`, `AUTH_RATE_LIMIT_MAX` |
| Observabilidad | `LOG_LEVEL`, `METRICS_SCRAPE_TOKEN` |
| Seguridad | `JWT_*`, `BCRYPT_SALT_ROUNDS`, `CORS_ORIGINS`, `TRUST_PROXY` |

## En Docker

`docker-compose.yml` define `x-app-environment` (anclas YAML) compartido por `api`, `migrate` y los
4 workers, con secretos exigidos (`${VAR:?...}` sin default usable). `docker-compose.dev.yml` los
relaja para local. Ver [[deployment]].

## Wikilinks

[[../15-reference/environment-variables]] · [[environments]] · [[../08-security/secrets-management]] ·
[[health-checks]]
