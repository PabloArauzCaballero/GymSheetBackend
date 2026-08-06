---
title: "Logging"
type: observability
status: verified
criticality: high
last_reviewed: "2026-08-06"
source_revision: "27f3fd2"
source_files:
  - "src/common/filters/http-exception.filter.ts"
  - "src/common/middleware/request-id.middleware.ts"
  - "src/common/redis/resilient-throttler.storage.ts"
  - "src/workers/worker-bootstrap.ts"
  - "src/main.ts"
tags: [backend, observability, logging]
---

# Logging

## Formato (VERIFICADO)

- **Logs estructurados**: objetos con un campo `event` que nombra la ocurrencia, emitidos por el
  `Logger` de NestJS a stdout. Ejemplos observados:
  - `application.started` (`main.ts:54-62`).
  - `http.request.failed` con `requestId`, `method`, `path`, `statusCode`, `errorName`, `errorMessage`
    (`http-exception.filter.ts:137-149`).
  - `throttler.storage_degraded` (`resilient-throttler.storage.ts:49`).
  - `worker.started`, `worker.shutdown_requested`, `worker.bootstrap_failed` (workers).
- **Correlación por petición**: cada log de error incluye `requestId`, tomado de la cabecera
  `x-request-id` saneada por `request-id.middleware.ts` (ver [[09-observability/correlation-ids]]).

## Redacción y datos sensibles (VERIFICADO)

- En **producción**, los errores 5xx registran `errorMessage: "Unexpected server error"` y **omiten
  el stack** (`http-exception.filter.ts:135-160`). Fuera de producción se incluye el mensaje/stack
  para diagnóstico.
- Los 4xx se registran como `warn` con contexto acotado (sin cuerpo de la petición).
- Política (regla `40-observability.md` y `observability-and-alerts.md` §Log policy): **no** registrar
  secretos, tokens, cabeceras de autorización, cadenas de conexión ni cuerpos de petición/respuesta;
  incluir `requestId`, método, ruta normalizada, estado y `event`.
- `dotenv` se carga con `quiet: true` para no romper el stream estructurado (`env.ts:5-6`).

## Workers (VERIFICADO — corrección F-015)

`bootstrapWorker` crea el contexto con `bufferLogs: true` y **debe** llamar `application.flushLogs()`
inmediatamente (`worker-bootstrap.ts:8-16`); sin ello, un application context nunca vuelca el búfer y
**todas** las líneas se pierden. Con la corrección, los tres workers de negocio emiten arranque
completo y el evento `worker.shutdown_requested` al recibir SIGTERM/SIGINT. Ver
[[08-security/security-findings]] (F-015) y [[09-observability/health-checks]].

## Limitación de ruido

`ResilientThrottlerStorage` limita el log de degradación a una entrada por minuto para que una caída
de Redis no inunde el log (`resilient-throttler.storage.ts:43-55`).

## Brechas

- Saneamiento de PII/secretos es **política, no un redactor central forzado** (ver
  [[08-security/security-findings]] SEC-5).
- El nivel de log se controla con `LOG_LEVEL`; verificar que en producción no sea `debug`/`trace`.

Relacionado: [[09-observability/correlation-ids]] · [[08-security/data-protection]] · [[09-observability/metrics]].
