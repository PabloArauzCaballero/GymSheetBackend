---
title: "Modelo de error"
type: api
status: verified
last_reviewed: "2026-08-06"
source_revision: "27f3fd2"
tags: [backend, api]
---

# Modelo de error

Evidencia: `src/common/filters/http-exception.filter.ts` (filtro global),
`src/common/pipes/zod-validation.pipe.ts`, `docs/endpoints/openapi.yaml`
(componentes `Problem`), `docs/endpoints/endpoints.md`.

## Formato

`HttpExceptionFilter` (`@Catch()` global) responde con
`application/problem+json`, compatible con RFC 9457, más campos de compatibilidad
v1:

```json
{
  "type": "about:blank",
  "title": "Bad Request",
  "status": 400,
  "detail": "Datos de entrada inválidos.",
  "instance": "/api/v1/exercises/not-a-uuid",
  "requestId": "00000000-0000-0000-0000-000000000000",
  "timestamp": "2026-08-06T00:00:00.000Z",
  "ok": false,
  "statusCode": 400,
  "path": "/api/v1/exercises/not-a-uuid",
  "error": { "message": "Datos de entrada inválidos.", "issues": {} }
}
```

- `title` se deriva del `HttpStatus` (p. ej. `NOT_FOUND → Not Found`).
- `requestId` sale de la cabecera `x-request-id` (o `unknown`).
- Los errores de validación Zod añaden `issues` (`error.flatten()`) tanto en la
  raíz como en `error.issues`.

## Redacción en producción (5xx)

Para `>= 500`:

- El **cuerpo** al cliente nunca lleva stack ni detalle de infraestructura: se
  responde `{ message: 'Error interno del servidor.' }` como `detail`.
- El **log** redacta el mensaje técnico y omite el stack **solo en producción**
  (`NODE_ENV === 'production'`): registra `errorMessage: 'Unexpected server error'`.
  Fuera de producción sí incluye mensaje y stack para depurar.
- `413` (payload too large) tiene mensaje fijo: "El cuerpo de la solicitud supera
  el límite permitido."

Los `4xx` se registran como `warn` con contexto estructurado (`event:
http.request.failed`, `requestId`, método, path, status). No se registran payloads
completos ni secretos ([[08-security/authorization]], regla de observabilidad).

## Catálogo de códigos comunes

| Código | Significado en esta API |
|---|---|
| `400` | Entrada inválida o formato de ruta (UUID) incorrecto |
| `401` | Token ausente/inválido/expirado o usuario inactivo (sesión ya no válida) |
| `403` | Rol insuficiente (`RolesGuard`), gate de licencia o transición de estado denegada |
| `404` | Recurso ausente **o no visible** (acceso horizontal ajeno) |
| `409` | Conflicto de unicidad o de estado de negocio (email duplicado, sesión abierta ya existente, serie repetida, intención idempotente) |
| `413` | Request o exportación síncrona demasiado grande |
| `422` | Onboarding con campos obligatorios pendientes (`/me/onboarding/complete`) |
| `429` | Límite de peticiones excedido — ver [[rate-limits]] |
| `500` | Error inesperado, sin detalles sensibles |
| `502` | Origen externo inválido o no disponible (conector dataset) |
| `503` | Dependencia o conector externo no disponible (readiness, dataset) |

> Nota: los conflictos de unicidad de Sequelize se traducen a `ConflictException`
> (409), nunca a 500 (regla de arquitectura).

Relacionado: [[conventions]] · [[authorization]] · [[rate-limits]]
