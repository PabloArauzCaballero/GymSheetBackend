---
title: "POST /auth/login"
type: api
status: verified
last_reviewed: "2026-08-06"
source_revision: "27f3fd2"
tags: [backend, api]
---

# POST /auth/login

Autentica credenciales y emite un access token JWT. Ruta efectiva:
`POST /api/v1/auth/login`.

- **Controlador**: `src/modules/auth/auth.controller.ts` → `login()`
- **Servicio**: `AuthService.login()` (`auth.service.ts`)
- **Esquema**: `loginSchema` (`auth.schemas.ts`)

## Auth y límites

- `@Public()` — no requiere token.
- `@Throttle` estricto: `AUTH_RATE_LIMIT_MAX` (def. 10) por `RATE_LIMIT_TTL_SECONDS`
  (def. 60 s). Ver [[04-api/rate-limits]].

## Request

`Content-Type: application/json`. Validado con Zod (descarta campos no declarados).

| Campo | Tipo | Regla |
|---|---|---|
| `email` | string | email, ≤180, normalizado a minúsculas |
| `password` | string | 8–128 |

```json
{ "email": "cliente@example.com", "password": "una-clave-de-ejemplo" }
```

## Response `201`

```json
{
  "ok": true,
  "data": {
    "accessToken": "<jwt>",
    "tokenType": "Bearer",
    "user": {
      "id": "00000000-0000-0000-0000-000000000000",
      "email": "cliente@example.com",
      "nombreCompleto": "Nombre Apellido",
      "rol": "CLIENTE"
    }
  }
}
```

Token HS256 firmado con `JWT_ACCESS_SECRET`, `issuer`/`audience`/`expiresIn`
configurados. Solo access token (no hay refresh — ver [[refresh]]).

## Errores

| Código | Causa |
|---|---|
| 400 | Body inválido (`Datos de entrada inválidos.`) |
| 401 | `Credenciales inválidas.` (mensaje uniforme) |
| 429 | Rate limit auth excedido |

## Seguridad

**Anti-enumeración temporal**: `login` siempre ejecuta un `bcrypt.compare`, incluso
sin cuenta (compara contra un hash señuelo). Tiempo y mensaje idénticos para email
conocido y desconocido → no se puede inferir si un email está registrado. Ver
[[04-api/authentication]] y [[04-api/authorization]].

Relacionado: [[index]]
