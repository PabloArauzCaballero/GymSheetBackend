---
title: "Referencia — Códigos de estado HTTP"
type: reference
status: verified
last_reviewed: "2026-08-06"
tags: [backend, reference, http]
---

# Códigos de estado HTTP

| Código | Uso en el backend | Nota |
|---:|---|---|
| 200 / 201 | Éxito / creación | — |
| 204 | Éxito sin cuerpo | — |
| 400 | Validación Zod fallida | Campos no declarados se descartan antes |
| 401 | No autenticado / login inválido | Mensaje uniforme (anti-enumeración) |
| 403 | Rol insuficiente (BFLA) | **Solo por rol**; acceso horizontal ajeno debe ser 404 |
| 404 | Recurso inexistente **o ajeno** | Regla del repo: acceso horizontal ajeno → 404, no 403. Ver [[08-security/authorization]] |
| 409 | Conflicto (único/estado) | ⚠ equipment/facilities pueden dar 500 en lugar de 409 (DATA-05) |
| 429 | Rate limit excedido | `ThrottlerGuard`; health con `@SkipThrottle` |
| 5xx | Error interno | Redactado en producción (sin stack/SQL) |

> [!warning] Inconsistencia conocida
> `training`/`exercises` devuelven 403 sobre recurso ajeno existente (debería ser 404). Ver [[14-audits/risks-register]] SEC-04.
