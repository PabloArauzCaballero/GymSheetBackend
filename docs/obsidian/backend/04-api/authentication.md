---
title: "Autenticación"
type: api
status: verified
last_reviewed: "2026-08-06"
source_revision: "27f3fd2"
tags: [backend, api]
---

# Autenticación

Evidencia: `src/modules/auth/` (`auth.controller.ts`, `auth.service.ts`,
`jwt.strategy.ts`, `auth.schemas.ts`), `src/config/env.ts`,
`src/common/guards/jwt-auth.guard.ts`.

## Esquema

- **JWT HS256**. El access token se firma con `JWT_ACCESS_SECRET` e incluye
  `issuer` (`JWT_ISSUER`), `audience` (`JWT_AUDIENCE`) y expiración
  (`JWT_ACCESS_EXPIRES_IN`, def. `15m`). Payload: `{ sub, email, role }`.
- Transporte: cabecera `Authorization: Bearer <access-token>`
  (`ExtractJwt.fromAuthHeaderAsBearerToken`).
- La estrategia (`JwtStrategy`) valida firma, expiración (`ignoreExpiration:
  false`), `issuer`, `audience` y `algorithms: ['HS256']`. Un token con otro
  algoritmo o emisor/audiencia se rechaza.

## Revalidación del principal en cada request

`JwtStrategy.validate()` no confía solo en el token: consulta
`usersRepository.findActiveById(payload.sub)` en PostgreSQL en **cada** petición
autenticada. Si el usuario fue borrado, desactivado o cambió de rol, la sesión se
corta con `401` ("La sesión ya no es válida"), sin esperar a que expire el token.
El `role` que usa `RolesGuard` proviene de la base de datos, no del token.

## Rutas

| Método | Ruta | Acceso | Propósito |
|---|---|---|---|
| POST | `/auth/register` | Público | Registrar cliente y emitir token |
| POST | `/auth/login` | Público | Autenticar y emitir token |
| GET | `/auth/me` | JWT | Devolver el principal revalidado |

`register` y `login` llevan `@Public()` (sin JWT) y un `@Throttle` más estricto
(`AUTH_RATE_LIMIT_MAX`, def. 10 / ventana) — ver [[rate-limits]]. Notas de
endpoint completas: [[rest/auth/login]] y [[rest/auth/refresh]].

## Login anti-enumeración

`AuthService.login` **siempre gasta un `bcrypt.compare`**, incluso sin cuenta: si
el email no existe compara contra un hash señuelo
(`UNKNOWN_ACCOUNT_PASSWORD_HASH`, generado en carga con `BCRYPT_SALT_ROUNDS`). Así
el tiempo de respuesta para un email desconocido es indistinguible del de uno
conocido, y el mensaje de error es uniforme ("Credenciales inválidas") para
`401`. Evita la enumeración de cuentas por temporización o por mensaje.

Registro: `register` hashea con `bcrypt.hash(password, BCRYPT_SALT_ROUNDS)` y
traduce colisión de unicidad a `409` (nunca `500`).

## Refresh flow — INFERIDO / no implementado

> [!warning] Contradicción código ↔ requisito
> El entorno define `JWT_REFRESH_SECRET` y `JWT_REFRESH_EXPIRES_IN` (def. `7d`) y
> `env.ts` exige que difieran del par de access. **Sin embargo, en la revisión
> `27f3fd2` no existe ningún endpoint ni servicio de refresh**: `AuthController`
> solo expone `register`/`login`/`me` y `AuthService` solo implementa
> `register`/`login`. No hay `POST /auth/refresh`, ni emisión, ni rotación, ni
> almacén de refresh tokens en `src/modules/auth`.
>
> Estado real: solo se emite **access token** en login/register (respuesta
> `{ accessToken, tokenType: 'Bearer', user }`). El "refresh" está preparado a
> nivel de configuración pero **no cableado**. Marcar como pendiente hasta que se
> implemente y se refleje en OpenAPI.

## Contexto de seguridad

- Secretos solo por variables de entorno; nunca versionados (ver [[08-security/authorization]]
  y reglas del proyecto). `.env.example` es el único versionado.
- Los guards globales cierran por defecto: `JwtAuthGuard` aplica a todo salvo
  `@Public()` (register, login, health, gateway).

Relacionado: [[authorization]] · [[conventions]] · [[error-model]] · [[03-domains/auth/index]]
