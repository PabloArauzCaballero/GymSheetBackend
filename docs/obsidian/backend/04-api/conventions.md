---
title: "Convenciones de la API"
type: api
status: verified
last_reviewed: "2026-08-06"
source_revision: "27f3fd2"
tags: [backend, api]
---

# Convenciones de la API

Evidencia: `src/main.ts`, `src/common/interceptors/response.interceptor.ts`,
`src/common/pipes/zod-validation.pipe.ts`, los `*.schemas.ts` y `*.mapper.ts` de
cada módulo, `docs/endpoints/endpoints.md`.

## Prefijo

Todas las rutas cuelgan de `API_PREFIX` (`application.setGlobalPrefix`), por
defecto **`api/v1`** (`env.ts`). Ejemplo efectivo: `POST /api/v1/auth/login`.
`health` y `gateway` también quedan bajo el prefijo.

## Formato de respuesta

`ResponseInterceptor` (global) envuelve toda respuesta JSON exitosa en un envelope:

```json
{ "ok": true, "data": { } }
```

`data` es el valor devuelto por el handler (objeto, array o página). **Excepción**:
si el `Content-Type` de la respuesta es `text/csv` o `text/plain`, el interceptor
no envuelve (pasa el cuerpo crudo). Aplica a `GET /export/workout-history/csv` y a
`GET /health/metrics`.

Páginas: los listados devuelven `data: { items, page, pageSize, total, totalPages }`
— ver [[pagination-filtering-sorting]].

## Validación con Zod

Toda entrada externa (body y query) se valida con `ZodValidationPipe(schema)`
usando los esquemas `*.schemas.ts`. En fallo lanza `400` con
`{ message: 'Datos de entrada inválidos.', issues: <flatten> }`.

- Los esquemas usan `additionalProperties: false` de facto (objetos Zod estrictos
  / `.transform`), por lo que **descartan campos no declarados** → protección
  contra mass assignment.
- Los identificadores de ruta se validan como UUID con `UuidParamPipe` antes de
  tocar persistencia (`400` si no es UUID).
- Compatibilidad v1: algunos campos externos permanecen en español
  (`nombreCompleto`, `pesoKg`, `grupoMuscular`…) y se transforman al identificador
  interno en inglés (p. ej. `nombreCompleto → fullName`).

## Mappers — nunca ORM directo

Los controladores/servicios **no devuelven modelos Sequelize**: usan
`*.mapper.ts` (p. ej. `mapUserToResponse`, `profile.mapper.ts`,
`exercise.mapper.ts`) para exponer solo campos públicos. Regla del proyecto y de
arquitectura (`.claude/rules/10-backend-architecture.md`).

## Otros límites de borde

- Cuerpo de request acotado por `REQUEST_BODY_LIMIT` (def. `1mb`, `413` si excede;
  `json({ strict: true })`).
- Cabeceras endurecidas con `helmet`; `x-powered-by` deshabilitado.
- CORS por allowlist (`CORS_ORIGINS`); métodos y cabeceras restringidos; expone
  `X-Request-Id`.
- Correlación por petición vía `requestIdMiddleware` (`X-Request-Id`).

Relacionado: [[error-model]] · [[pagination-filtering-sorting]] · [[authentication]]
