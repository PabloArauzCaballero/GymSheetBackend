---
title: "Rate limiting"
type: api
status: verified
last_reviewed: "2026-08-06"
source_revision: "27f3fd2"
tags: [backend, api]
---

# Rate limiting

Evidencia: `src/config/env.ts`, `src/modules/auth/auth.controller.ts`
(`@Throttle`), `src/modules/health/health.controller.ts` (`@SkipThrottle`),
`src/app.module.ts` (`ThrottlerGuard` global). Backend compartido opcional vía
Redis.

## Parámetros de entorno

| Variable | Default | Rol |
|---|---|---|
| `RATE_LIMIT_TTL_SECONDS` | 60 | Ventana global (segundos) |
| `RATE_LIMIT_MAX` | 100 | Máx. peticiones por ventana (rutas normales) |
| `AUTH_RATE_LIMIT_MAX` | 10 | Máx. por ventana en rutas de auth (más estricto) |
| `REDIS_URL` | — | Almacén compartido de contadores (opcional) |
| `REDIS_REQUIRED` | false | Si `true`, el arranque falla sin `REDIS_URL` |
| `REDIS_CONNECT_TIMEOUT_MS` | 5000 | Timeout de conexión a Redis |

## Aplicación

- `ThrottlerGuard` es guard **global** (`app.module.ts`), primero en la cadena.
  Límite por defecto: `RATE_LIMIT_MAX` por `RATE_LIMIT_TTL_SECONDS`.
- **Auth más estricto**: `POST /auth/register` y `POST /auth/login` llevan
  `@Throttle({ default: { limit: AUTH_RATE_LIMIT_MAX, ttl: RATE_LIMIT_TTL_SECONDS
  * 1000 } })`. Reduce fuerza bruta y enumeración (complementa el anti-enumeración
  de [[authentication]]).
- Exceder el límite → **429** (problem+json, ver [[error-model]]).

## Redis compartido (multi-instancia)

Sin `REDIS_URL`, el throttler usa contadores **en memoria por proceso**: en
despliegue horizontal el límite efectivo se multiplica por el nº de instancias.
Con `REDIS_URL` los contadores se comparten. `REDIS_REQUIRED=true` fuerza fallo de
arranque para no degradar silenciosamente en producción escalada. Regla de
seguridad del proyecto: rate limiting compartido vía Redis en multi-instancia.

## Health exento

`HealthController` lleva `@SkipThrottle()`: las sondas **nunca** dependen del
backend de rate limiting. Motivo documentado en el propio controlador: si el
throttler dependiera de un Redis remoto, una caída de Redis haría fallar la sonda
de liveness de un orquestador y reiniciaría procesos sanos en bucle. `health/live`
y `health/ready` permanecen disponibles con Redis caído.

Relacionado: [[authentication]] · [[error-model]] · [[15-reference/environment-variables]]
