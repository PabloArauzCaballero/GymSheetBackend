---
title: "Referencia — Catálogo de errores"
type: reference
status: verified
last_reviewed: "2026-08-06"
tags: [backend, reference, errors]
related: ["[[04-api/error-model]]"]
---

# Catálogo de errores

> Taxonomía de errores del backend. Detalle del modelo en [[04-api/error-model]]. En producción los 5xx se redactan (sin stack/SQL/credenciales).

| Categoría | HTTP | Origen típico | Mensaje externo | Reintentable |
|---|---:|---|---|---:|
| Validación | 400 | Zod (`*.schemas.ts`) | Detalle de campos | No |
| Autenticación | 401 | `auth`, `JwtAuthGuard` | Uniforme (anti-enumeración) | No |
| Autorización (rol) | 403 | `RolesGuard` | Prohibido | No |
| Recurso/propiedad | 404 | servicios (ownership) | No encontrado | No |
| Conflicto | 409 | únicos / estado | Conflicto | No |
| Conflicto no traducido | **500** | equipment/facilities (UniqueConstraint) | Redactado | No — **defecto DATA-05** |
| Rate limit | 429 | `ThrottlerGuard` | Demasiadas peticiones | Sí (con backoff) |
| Dependencia externa | 502/504 | gateway notificaciones, dataset | Redactado | Sí (worker reintenta) |
| Persistencia/timeout | 500/503 | DB, `DB_STATEMENT_TIMEOUT_MS` | Redactado | Depende |
| Readiness | 503 | `/health/ready` (esquema/Redis) | — | Sí |

Ver [[15-reference/status-codes]] · [[14-audits/risks-register]].
