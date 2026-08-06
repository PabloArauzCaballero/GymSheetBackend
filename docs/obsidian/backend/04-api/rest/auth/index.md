---
title: "REST · Auth"
type: api
status: verified
last_reviewed: "2026-08-06"
source_revision: "27f3fd2"
tags: [backend, api]
---

# REST · Auth

Controlador: `src/modules/auth/auth.controller.ts` · Servicio:
`src/modules/auth/auth.service.ts` · Esquemas: `auth.schemas.ts`.

| Método | Ruta | Auth | Body/validación | Errores | Propósito |
|---|---|---|---|---|---|
| POST | `/auth/register` | Público (throttle auth) | `registerSchema` (`email`, `password` 8–128, `nombreCompleto` 3–180) | 400, 409, 429 | Alta de cliente + token |
| POST | `/auth/login` | Público (throttle auth) | `loginSchema` (`email`, `password`) | 400, 401, 429 | Autenticar + token |
| GET | `/auth/me` | JWT | — | 401 | Principal revalidado |

- JWT HS256, revalidación del principal en cada request, login anti-enumeración:
  ver [[04-api/authentication]].
- Rate limit estricto (`AUTH_RATE_LIMIT_MAX`): ver [[04-api/rate-limits]].
- Notas de endpoint: [[login]] · [[refresh]].

> `POST /auth/refresh` **no está implementado** en `27f3fd2` pese a existir
> `JWT_REFRESH_SECRET`. Ver [[refresh]].

Relacionado: [[04-api/authorization]] · [[03-domains/auth/index]]
