---
title: "Referencia — Variables de entorno"
type: reference
status: verified
criticality: high
last_reviewed: "2026-08-06"
source_revision: "27f3fd2"
source_files: [".env.example"]
tags: [backend, reference, config]
---

# Variables de entorno

> Extraídas de `.env.example` (VERIFICADO). **Valores reales nunca se documentan.** Solo `.env.example` se versiona. Ver [[08-security/secrets-management]].

## Aplicación / red

| Variable | Propósito | Requerida | Ejemplo seguro |
|---|---|---:|---|
| `NODE_ENV` | Entorno de ejecución | Sí | `production` |
| `PORT` / `API_PORT` | Puerto HTTP de la API | Sí | `3000` |
| `API_PREFIX` | Prefijo global de rutas | No | `api` |
| `CORS_ORIGINS` | Allowlist de orígenes CORS | Sí | `https://app.example.com` |
| `TRUST_PROXY` | Confianza en proxy inverso | No | `1` |
| `REQUEST_BODY_LIMIT` | Límite de tamaño de body | No | `1mb` |
| `LOG_LEVEL` | Nivel de logs | No | `info` |
| `BUSINESS_TIME_ZONE` | Zona horaria de negocio | No | `America/Guayaquil` |

## Base de datos (PostgreSQL)

| Variable | Propósito | Requerida |
|---|---|---:|
| `DB_HOST` `DB_PORT` `DB_NAME` `DB_USER` `DB_PASSWORD` | Conexión principal | Sí |
| `DB_SSL` `DB_SSL_REJECT_UNAUTHORIZED` | TLS | No |
| `DB_LOGGING` | Log de SQL | No |
| `DB_POOL_MAX` `DB_POOL_MIN` `DB_POOL_ACQUIRE_MS` `DB_POOL_IDLE_MS` | Pool de conexiones | No |
| `DB_CONNECT_TIMEOUT_MS` `DB_STATEMENT_TIMEOUT_MS` | Timeouts | No |

## Autenticación / JWT

| Variable | Propósito | Requerida |
|---|---|---:|
| `JWT_ACCESS_SECRET` `JWT_REFRESH_SECRET` | Secretos de firma HS256 | Sí (**secreto**) |
| `JWT_ACCESS_EXPIRES_IN` `JWT_REFRESH_EXPIRES_IN` | Expiración | No |
| `JWT_ISSUER` `JWT_AUDIENCE` | Claims iss/aud | No |
| `BCRYPT_SALT_ROUNDS` | Coste bcrypt | No |

## Rate limiting / Redis

| Variable | Propósito | Requerida |
|---|---|---:|
| `REDIS_URL` | Backend de rate limiting compartido | Condicional |
| `REDIS_REQUIRED` | Falla el arranque si Redis no está | No |
| `REDIS_CONNECT_TIMEOUT_MS` | Timeout de conexión | No |
| `RATE_LIMIT_TTL_SECONDS` `RATE_LIMIT_MAX` `AUTH_RATE_LIMIT_MAX` | Límites de petición | No |

## Métricas / acceso

| Variable | Propósito | Requerida |
|---|---|---:|
| `METRICS_SCRAPE_TOKEN` | Protege `/health/metrics` | Recomendada (**secreto**) |
| `ACCESS_POLICY_VERSION` | Versión de política de acceso | No |
| `ACCESS_MOCK_ENABLED` | Habilita endpoints mock de acceso | No |
| `GATEWAY_ENABLED` | Habilita gateway | No |

## Workers / outbox

| Variable | Propósito |
|---|---|
| `WORKER_POLL_INTERVAL_MS` `WORKER_BATCH_SIZE` `WORKER_CONCURRENCY` `WORKER_LOCK_TIMEOUT_MS` `WORKER_MAX_ATTEMPTS` | Loop de workers |
| `OUTBOX_RETENTION_DAYS` `OUTBOX_PRUNE_BATCH_SIZE` | Retención de outbox |
| `REMINDER_SCAN_INTERVAL_MS` | Escaneo de recordatorios |

## Notificaciones (gateway externo)

| Variable | Propósito | Requerida |
|---|---|---:|
| `NOTIFICATION_DELIVERY_PROVIDER` | Proveedor de entrega | No |
| `NOTIFICATION_GATEWAY_URL` | Endpoint del gateway | Condicional |
| `NOTIFICATION_GATEWAY_SECRET` | Auth del gateway | Condicional (**secreto**) |
| `NOTIFICATION_GATEWAY_ALLOWED_HOSTS` | Allowlist SSRF | Sí (si gateway) |
| `NOTIFICATION_GATEWAY_TIMEOUT_MS` | Timeout | No |
| `WHATSAPP_MEMBERSHIP_PHONE` | Teléfono de membresía WhatsApp | No |

## Dataset de ejercicios (import externo)

`EXERCISES_DATASET_ENABLED`, `EXERCISES_DATASET_JSON_URL`, `EXERCISES_DATASET_ALLOWED_HOSTS` (allowlist SSRF), `EXERCISES_DATASET_TIMEOUT_MS`, `EXERCISES_DATASET_MAX_RESPONSE_BYTES`, `EXERCISES_DATASET_BATCH_SIZE`, `EXERCISES_DATASET_MIN_RECORDS`, `EXERCISES_DATASET_REFRESH_INTERVAL_MS`, `EXERCISES_DATASET_REFRESH_RETRY_MS`, `EXERCISES_DATASET_IMPORT_MEDIA`, `EXERCISES_DATASET_MEDIA_LICENSE_CONFIRMED`, `EXERCISES_OPEN_MEDIA_ENABLED`, `EXERCISES_OPEN_MEDIA_JSON_URL`, `EXERCISES_OPEN_MEDIA_BASE_URL`.

## Seeds

`SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD` (**secreto**), `SEED_ADMIN_FULL_NAME`, `SEED_MOCK_PASSWORD` (**secreto**).

> [!danger] Secretos
> `JWT_*_SECRET`, `DB_PASSWORD`, `NOTIFICATION_GATEWAY_SECRET`, `METRICS_SCRAPE_TOKEN`, `SEED_*_PASSWORD` son secretos: solo por env, nunca en el repo ni en logs.
