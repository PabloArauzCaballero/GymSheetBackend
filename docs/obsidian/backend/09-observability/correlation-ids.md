---
title: "Correlation IDs"
type: observability
status: verified
criticality: high
last_reviewed: "2026-08-06"
source_revision: "27f3fd2"
source_files:
  - "src/common/middleware/request-id.middleware.ts"
  - "src/common/filters/http-exception.filter.ts"
  - "src/modules/integration/domain-event.model.ts"
tags: [backend, observability, correlation]
---

# Correlation IDs

## `x-request-id` por petición (VERIFICADO)

`requestIdMiddleware` (`request-id.middleware.ts`) asigna un identificador de correlación a cada
petición y respuesta:

- Acepta el valor entrante **solo** si cumple `^[A-Za-z0-9._-]{8,128}$`; de lo contrario genera un
  `randomUUID()`. Esto **sanea contra inyección de cabeceras** (no se propaga contenido arbitrario).
- Escribe el valor en `request.headers['x-request-id']` y en la respuesta `X-Request-Id`.
- El `HttpExceptionFilter` incluye `requestId` en el cuerpo de error (`problem+json`) y en el log
  `http.request.failed`, permitiendo cruzar la respuesta del cliente con los logs del servidor.
- `X-Request-Id` está en `exposedHeaders`/`allowedHeaders` de CORS (`main.ts:44-45`), de modo que un
  cliente puede reenviar el mismo id.

## Correlación de eventos de dominio (VERIFICADO)

`integration.domain_events` incluye `correlation_id`, `causation_event_id` y `trace_id`
(`domain-event.model.ts:50-57`), lo que permite encadenar causa→efecto entre eventos del outbox y
ligarlos al rastro de auditoría. Ver [[08-security/audit-trail]].

## Flujo de correlación

```txt
Cliente (x-request-id opcional)
  → middleware (valida o genera)
  → logs estructurados con requestId
  → respuesta con X-Request-Id
  → (trabajo asíncrono) domain_events.correlation_id / trace_id
```

## Brechas

- No hay **propagación automática** de `requestId` hacia los workers/outbox; la correlación asíncrona
  depende de poblar `correlation_id`/`trace_id` al publicar el evento (INFERIDO; verificar en el
  publisher). Ver [[09-observability/tracing]].

Relacionado: [[09-observability/logging]] · [[09-observability/tracing]] · [[08-security/audit-trail]].
