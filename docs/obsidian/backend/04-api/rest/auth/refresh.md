---
title: "POST /auth/refresh"
type: api
status: verified
last_reviewed: "2026-11-11"
tags: [backend, api]
---

# POST /auth/refresh

Renueva la sesión: canjea un refresh token por un par nuevo (`accessToken` +
`refreshToken`). Implementado en `AuthController.refresh` → `AuthService.refresh` →
`RefreshTokenService.rotate` (SEC-02).

## Contrato

- Público (`@Public()`): el access token suele estar vencido cuando se llama.
- Cuerpo: `{ "refreshToken": string }` (Zod, 20–200 caracteres).
- `200` con el mismo envelope que el login: `{ ok, data: { accessToken, refreshToken, tokenType, user } }`.
- `401` si el token no existe, venció, ya fue canjeado o la cuenta no está activa.
- Límite general de peticiones, **no** el estricto de login: el token tiene 256 bits
  aleatorios (no se adivina) y muchos socios comparten la IP del Wi-Fi del gimnasio.

## Reglas

- **Rotación:** el token presentado muere y se emite otro de la misma familia (sesión).
- **Ventana deslizante:** el nuevo vence `JWT_REFRESH_EXPIRES_IN` (def. `90d`) después de
  ESTE uso. La sesión solo termina tras ese tiempo sin uso.
- **Reuso:** presentar un token ya canjeado o revocado revoca toda la familia, incluido el
  sucesor del dueño legítimo.
- **Almacenamiento:** `auth.refresh_tokens` guarda solo un HMAC-SHA256 del token
  (clave `JWT_REFRESH_SECRET`), nunca el token.
- La fila se bloquea (`SELECT … FOR UPDATE`) para que dos canjes simultáneos no roten dos veces.

## Cierre de sesión

`POST /auth/logout` con el mismo cuerpo revoca la familia. Es idempotente
(`{ revoked: false }` si ya estaba cerrada).

## Evidencia

- Unitarias: `src/modules/auth/refresh-token.service.spec.ts`.
- e2e contra PostgreSQL: `test/auth-refresh.e2e-spec.ts`.

Relacionado: [[index]] · [[login]] · [[04-api/authentication]]
