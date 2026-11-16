---
title: "Referencia — Variables de entorno"
type: reference
status: verified
criticality: high
last_reviewed: "2026-11-16"
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
| `TRUST_PROXY_HOPS` | Saltos de proxy de confianza cuando `TRUST_PROXY` está activo (0–5); la BFF web reenvía `X-Forwarded-For` | No | `1` |
| `REQUEST_BODY_LIMIT` | Límite de tamaño de body | No | `1mb` |
| `LOG_LEVEL` | Nivel de logs | No | `info` |
| `BUSINESS_TIME_ZONE` | Zona horaria de negocio | No | `America/Guayaquil` |
| `BUSINESS_SIGNUP_ENABLED` | Abre `POST /business/signup` (ADR-0020). Cerrada: `404 BUSINESS_SIGNUP_DISABLED`. En producción sigue cerrada mientras los textos legales de negocios sean borradores (`BUSINESS_LEGAL_TEXTS_ARE_DRAFTS`) | No (`false`) | `false` |
| `HANDLE_AVAILABILITY_RATE_LIMIT_MAX` | Peticiones por cliente a `GET /public/handles/:handle/availability` por ventana `RATE_LIMIT_TTL_SECONDS` | No (`30`) | `30` |

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

## Anti-bot de alta de cuentas ([[ADR-0013]])

| Variable | Propósito | Por defecto | Requerida |
|---|---|---|---:|
| `REGISTRATION_TICKET_SECRET` | Clave HMAC de tickets de formulario y nonces de atestación (≥ 32) | aleatoria por proceso fuera de producción | Sí en producción (**secreto**) |
| `SIGNUP_TICKET_REQUIRED` | Sin ticket se rechaza (`false` sólo para cortar clientes viejos) | `true` | No |
| `SIGNUP_MIN_FILL_MS` | Tiempo mínimo entre emitir el ticket y enviar | `3000` | No |
| `SIGNUP_LIMIT_PER_IP_HOUR` `SIGNUP_LIMIT_PER_INSTALLATION_DAY` `SIGNUP_LIMIT_PER_EMAIL_DOMAIN_HOUR` | Velocidad de altas (Redis si existe; si no, por proceso) | `5` / `3` / `30` | No |
| `SIGNUP_EMAIL_DOMAIN_ALLOWLIST` | Dominios exentos del límite por dominio | gmail, outlook, hotmail, live, yahoo, icloud, me, proton | No |
| `ANTIBOT_HTTP_TIMEOUT_MS` | Timeout de Turnstile, Google y HIBP | `3000` | No |
| `TURNSTILE_SECRET` | Activa Cloudflare Turnstile en el canal WEB | vacío (apagado) | No (**secreto**) |
| `TURNSTILE_FAIL_CLOSED` | Rechazar si Cloudflare no responde | `false` | No |
| `ATTESTATION_ENABLED` | Exige Play Integrity en Android | `false` | No |
| `PLAY_INTEGRITY_PACKAGE_NAME` `PLAY_INTEGRITY_SERVICE_ACCOUNT_JSON` | Paquete y cuenta de servicio de Play Integrity | vacío | Si `ATTESTATION_ENABLED` (**secreto**) |
| `PASSWORD_BREACH_CHECK_ENABLED` | Consulta k-anónima a Have I Been Pwned (sólo riesgo) | `false` | No |

`IP_HASH_SECRET` (ya existente) también firma el `ip_hmac` de `auth.signup_audit`; sin él no se guarda evidencia de IP.

## Acceso con Google / Apple

| Variable | Propósito | Por defecto | Requerida |
|---|---|---|---:|
| `AUTH_GOOGLE_ENABLED` | Activa `POST /auth/google` y `/auth/google/complete` (apagado = 404) | `false` | No |
| `GOOGLE_CLIENT_IDS` | Client ids aceptados como `aud`, separados por comas | vacío | Si `AUTH_GOOGLE_ENABLED` |
| `AUTH_APPLE_ENABLED` | Activa `POST /auth/apple` y `/auth/apple/complete` (apagado = 404) | `false` | No |
| `APPLE_CLIENT_IDS` | Bundle id / Services id aceptados como `aud` | vacío | Si `AUTH_APPLE_ENABLED` |

`IP_HASH_SECRET` también firma `auth.user_devices.last_ip_hmac`; sin él no se guarda evidencia de IP del dispositivo.

Desde la franja 4 (ADR-0014) `IP_HASH_SECRET` firma además `public.password_reset_tokens.ip_hmac`,
`admin.audit_log.ip_hmac` y `training.routine_progress_download_audits.ip_hmac`: la API ya no guarda
ninguna IP en claro. La migración `202611180201` convierte las IP existentes con el secreto presente
al correrla (sin secreto, las anula). `yarn db:privacy:retention` (alias `db:signups:retention`;
el worker `privacy-retention` lo corre cada 24 h) anula todo HMAC de más de 90 días. Cambiar el secreto rompe la correlación con
los HMAC anteriores, que de todos modos caducan a los 90 días.

`IP_HASH_SECRET` es el pepper de privacidad de la API (ADR-0015): también firma el correo de una
cuenta sancionada que se cierra (`moderation.closed_account_sanctions.email_hmac`), para que volver a
registrarse con ese correo herede las faltas. Sin él no se guarda ese registro y cerrar la cuenta
borra las sanciones. Rotarlo deja sin efecto los registros existentes.

**`IP_HASH_SECRET` es obligatoria con `NODE_ENV=production`** (32 caracteres o más; `src/config/privacy-env.ts`):
sin ella la API y los workers no arrancan y el error de inicio nombra la variable. Fuera de producción sigue
siendo opcional. Los dos compose la pasan a los contenedores; `docker-compose.coolify.yml` la exige (`:?`)
porque ese despliegue arranca con `NODE_ENV=development` y la validación de producción no lo cubriría.

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

## Almacenamiento de media

| Variable | Propósito | Por defecto | Requerida |
|---|---|---|---:|
| `MEDIA_STORAGE_PROVIDER` | `local` (disco) o `minio` (ADR-0010, ADR-0017) | `local` | No |
| `MEDIA_STORAGE_LOCAL_ROOT` `MEDIA_STORAGE_PUBLIC_BASE_URL` | Raíz en disco y URL pública del media | `storage/media`, `http://localhost:3000/media` | No |
| `MINIO_ENDPOINT` `MINIO_ACCESS_KEY` `MINIO_SECRET_KEY` `MINIO_BUCKET` | Conexión a MinIO (host interno, no la URL pública) | vacío, `gymsheet-media` | Si `minio` (**secreto** la clave) |
| `MEDIA_USER_CONTENT_DELETABLE` | `true`: el usuario MinIO de la API puede borrar todas las versiones bajo `users/*` y `business/*/public/*` (política en ADR-0017 y ADR-0020). `false`: el contenido de las personas se conserva y ningún texto puede prometer su borrado. Sólo `true`/`false`; el disco local siempre borra | vacío = `true` | **Sí en producción con `minio`** |

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
> `JWT_*_SECRET`, `DB_PASSWORD`, `REGISTRATION_TICKET_SECRET`, `TURNSTILE_SECRET`, `PLAY_INTEGRITY_SERVICE_ACCOUNT_JSON`, `NOTIFICATION_GATEWAY_SECRET`, `METRICS_SCRAPE_TOKEN`, `IP_HASH_SECRET`, `SEED_*_PASSWORD` son secretos: solo por env, nunca en el repo ni en logs.
