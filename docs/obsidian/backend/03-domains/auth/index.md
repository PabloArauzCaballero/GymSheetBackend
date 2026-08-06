---
title: "Auth"
type: domain
status: verified
criticality: high
last_reviewed: "2026-08-06"
source_revision: "27f3fd2"
domain: "auth"
source_files: [
  "src/modules/auth/auth.controller.ts",
  "src/modules/auth/auth.service.ts",
  "src/modules/auth/auth.schemas.ts",
  "src/modules/auth/jwt.strategy.ts",
  "src/modules/auth/auth.module.ts"
]
tags: [backend, domain]
related: ["[[03-domains/users/index]]", "[[08-security/index]]"]
---

# Auth

## Resumen

Autenticación: registro y login de clientes con JWT HS256, hashing bcrypt, resistencia a enumeración y
revalidación del principal contra la BD en cada request.

## Responsabilidad

- Registrar clientes y emitir access token.
- Autenticar por credenciales.
- Validar el JWT y re-consultar el usuario en cada petición (`jwt.strategy`).

## Límites

- No gestiona roles/permisos (eso es `RolesGuard` + módulos de dominio).
- **Sin refresh token**: no se emite/rota refresh (la premisa "access+refresh" no se cumple;
  `INFERIDO`: fuera de alcance o no implementado).

## Entradas

HTTP `/auth/*` (`@Public` en register/login), Zod (`auth.schemas.ts`).

## Salidas

`{ accessToken, user }`; `AuthenticatedUser` inyectado en `@CurrentUser`.

## Casos de uso

Registro de cliente, login, `GET /auth/me`.

## Reglas de negocio

- **Login**: `findActiveByEmail` (status ACTIVE) → `bcrypt.compare` → 401 `Credenciales inválidas.`.
- **JWT HS256** firmado con `JWT_ACCESS_SECRET`, `expiresIn=JWT_ACCESS_EXPIRES_IN`, issuer/audience,
  payload `{sub,email,role}`.
- **Anti-enumeración**: hash señuelo `UNKNOWN_ACCOUNT_PASSWORD_HASH` a nivel de módulo; login siempre
  gasta un `compare` (real o señuelo) y devuelve el mismo mensaje para email desconocido y contraseña
  incorrecta.
- **Revalidación del principal** (`jwt.strategy.validate`): re-consulta `findActiveById(payload.sub)`
  en cada request; 401 si el usuario fue borrado/inactivado; el `role` se re-lee de BD, no del token.

## Componentes principales

| Componente | Tipo | Responsabilidad | Evidencia |
|---|---|---|---|
| `AuthController` | Controller | `/auth/register`, `/auth/login`, `/auth/me` | `auth.controller.ts` |
| `AuthService` | Service | `register`, `login`, `buildAuthResponse` | `auth.service.ts` |
| `JwtStrategy` | Strategy | Verifica token y revalida principal | `jwt.strategy.ts` |

## Entidades y datos

Sin modelos propios; consume `UserModel` vía `UsersRepository`. Ver [[03-domains/users/index]].

## Endpoints o contratos

- `POST /auth/register` (`@Public` + `@Throttle`).
- `POST /auth/login` (`@Public` + `@Throttle`).
- `GET /auth/me` (protegido).
- [[04-api/index]].

## Eventos

Ninguno propio.

## Dependencias

`PassportModule`, `UsersModule` (`UsersRepository`). `JwtService` provisto globalmente (`INFERIDO`: no
importa `JwtModule` en este módulo).

## Autenticación y permisos

Guard global `JwtAuthGuard`; `@Public()` exime register/login. Sin lógica de rol/propiedad aquí.

## Manejo de errores

`ConflictException` (email duplicado, pre-check + `UniqueConstraintError`), `UnauthorizedException`
(login inválido, sesión inválida).

## Transacciones y consistencia

N/A.

## Observabilidad

`INFERIDO`: sin logging específico observado.

## Pruebas

- `auth.service.spec.ts` — resistencia a enumeración (mismo mensaje; `compare` llamado 1 vez con
  señuelo en email desconocido).
- `jwt.strategy.spec.ts` — devuelve el rol persistido actual (token CLIENT → BD ADMIN gana); rechaza si
  `findActiveById` es null.

## Riesgos

- Sin refresh token → tokens de acceso longevos o re-login forzado.
- Hit a BD por request en `jwt.strategy` (corrección vs latencia).
- Hash señuelo se calcula una vez al cargar con los rounds configurados; cambiar
  `BCRYPT_SALT_ROUNDS` debilita la paridad de tiempos (`INFERIDO` menor).

## Referencias al código

- `auth.service.ts` → `login`, `register`, `buildAuthResponse`.
- `jwt.strategy.ts` → `validate`.
- `auth.schemas.ts` → `registerSchema`, `loginSchema`, `normalizedEmailSchema`.

## Relaciones

[[03-domains/users/index]] · [[08-security/index]]
