---
title: "Autenticación"
type: security
status: verified
criticality: high
last_reviewed: "2026-08-06"
source_revision: "27f3fd2"
source_files:
  - "src/modules/auth/auth.service.ts"
  - "src/modules/auth/jwt.strategy.ts"
  - "src/modules/auth/auth.controller.ts"
  - "src/common/guards/jwt-auth.guard.ts"
  - "src/config/env.ts"
tags: [backend, security, auth, jwt]
---

# Autenticación

> Defensivo. Describe el mecanismo y sus controles; no incluye vectores de ataque.

## Mecanismo (VERIFICADO)

- **JWT HS256**. El access token se firma con `JWT_ACCESS_SECRET` (mínimo 64 caracteres) e incluye
  `issuer` y `audience` validados en emisión y verificación (`auth.service.ts:105-111`,
  `jwt.strategy.ts:11-18`).
- **Payload mínimo**: `sub` (id), `email`, `role`. No transporta datos sensibles adicionales.
- **Expiración**: `JWT_ACCESS_EXPIRES_IN` (por defecto `15m`); `ignoreExpiration: false`.
- **Contraseñas con bcrypt** (`bcryptjs`), coste `BCRYPT_SALT_ROUNDS` (10–14, por defecto 12).
- **Refresh**: existen `JWT_REFRESH_SECRET`/`JWT_REFRESH_EXPIRES_IN` (`7d`) y una validación que exige
  que los secretos de access y refresh sean distintos (`env.ts:302-307`). **INFERIDO / brecha:** no
  se observa endpoint de refresh ni almacén/rotación/revocación de refresh tokens en el código
  revisado; la funcionalidad parece preparada pero no expuesta. Ver [[08-security/security-findings]]
  (SEC-2).

## Revalidación del principal contra la DB (control clave)

En **cada** petición autenticada, `JwtStrategy.validate` consulta `findActiveById(payload.sub)` y
rechaza si el usuario ya no existe o no está activo (`jwt.strategy.ts:26-37`). Un token válido de un
usuario eliminado, bloqueado o con rol cambiado deja de funcionar de inmediato, sin esperar a la
expiración.

## Anti-enumeración temporal (control clave)

El login **siempre gasta un `bcrypt.compare`**, incluso cuando el email no corresponde a ninguna
cuenta: se compara contra un hash señuelo generado al cargar el módulo con el mismo coste
(`auth.service.ts:16-19,77-83`). Así el tiempo de respuesta para un email conocido y uno desconocido
es equivalente y no revela por temporización si una dirección está registrada. El error devuelto es
genérico ("Credenciales inválidas.").

## Guard y rutas públicas

- `JwtAuthGuard` es **global** (`app.module.ts:97`); protege todo por defecto.
- Las rutas se abren explícitamente con `@Public()` (`register`, `login`, health). Todo lo demás
  exige token válido.
- `/auth/register` y `/auth/login` tienen rate limit reducido `AUTH_RATE_LIMIT_MAX` (por defecto 10)
  vía `@Throttle` (`auth.controller.ts:11-16`).

## Configuración relevante

Ver la lista completa en [[15-reference/environment-variables]]:
`JWT_ACCESS_SECRET`, `JWT_ACCESS_EXPIRES_IN`, `JWT_REFRESH_SECRET`, `JWT_REFRESH_EXPIRES_IN`,
`JWT_ISSUER`, `JWT_AUDIENCE`, `BCRYPT_SALT_ROUNDS`, `AUTH_RATE_LIMIT_MAX`.

## Brechas / advertencias

- Sin revocación anticipada de access tokens salvo por la revalidación del principal (mitiga el caso
  usuario-desactivado, no el caso robo-de-token-de-usuario-activo).
- Refresh/rotación no implementados en el código revisado (SEC-2).

Relacionado: [[04-api/authentication]] · [[03-domains/auth/index]] · [[08-security/authorization]].
