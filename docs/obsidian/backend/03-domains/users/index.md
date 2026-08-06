---
title: "Users"
type: domain
status: verified
criticality: low
last_reviewed: "2026-08-06"
source_revision: "27f3fd2"
domain: "users"
source_files: [
  "src/modules/users/users.controller.ts",
  "src/modules/users/users.service.ts",
  "src/modules/users/users.repository.ts",
  "src/modules/users/user.model.ts",
  "src/modules/users/user.mapper.ts"
]
tags: [backend, domain]
related: ["[[03-domains/auth/index]]", "[[03-domains/profiles/index]]"]
---

# Users

## Resumen

Modelo de usuario y su repositorio, reusado por `auth`, `profiles`, `membership`, `access-control`.
Expone únicamente la lectura del usuario actual (`/users/me`).

## Responsabilidad

- Definir `UserModel` (identidad, credencial hasheada, rol, estado).
- Proveer `UsersRepository` (findByEmail/findActiveById/createClient) a otros módulos.

## Límites

- No emite tokens (eso es `auth`).
- No gestiona perfiles/onboarding (eso es `profiles`).

## Entradas

HTTP `GET /users/me` (protegido); consumo interno vía repositorio.

## Salidas

DTO mapeado por `user.mapper.ts` (omite `passwordHash`).

## Casos de uso

Obtener el usuario actual; que otros módulos resuelvan usuarios por id/email.

## Reglas de negocio

`getActiveUserOrFail(userId)` → `findActiveById` o `NotFoundException` `Usuario no encontrado o
inactivo.`.

## Componentes principales

| Componente | Tipo | Responsabilidad | Evidencia |
|---|---|---|---|
| `UsersController` | Controller | `GET /users/me` | `users.controller.ts` |
| `UsersService` | Service | `getActiveUserOrFail` | `users.service.ts` |
| `UsersRepository` | Repository | Consultas reusadas por otros módulos | `users.repository.ts` |

## Entidades y datos

`UserModel` (`usuarios`): `email` único, `passwordHash`, `fullName`, `role` (default CLIENT),
`status` (default ACTIVE), `registeredAt`, `HasOne AnthropometricProfileModel`. Detalle:
[[05-data/index]].

## Endpoints o contratos

`GET /users/me` (protegido). [[04-api/index]].

## Eventos

Ninguno (las altas de cliente emiten `CUSTOMER_REGISTERED` desde `membership`).

## Dependencias

`SequelizeModule.forFeature([UserModel])`; exporta `UsersRepository` + `UsersService`.

## Autenticación y permisos

Propiedad implícita: el id sale de `@CurrentUser()`, nunca del cliente. Inactivo/ausente → 404.

## Manejo de errores

`NotFoundException` únicamente.

## Transacciones y consistencia

N/A.

## Observabilidad

N/A.

## Pruebas

Sin spec propio en el módulo.

## Riesgos

- `mapUserToResponse` expone `estado`/`fechaRegistro`; `passwordHash` correctamente omitido.
- `UsersRepository` ampliamente exportado/usado; el scoping por token cubre `/me`.

## Referencias al código

- `users.service.ts` → `getActiveUserOrFail`.
- `user.model.ts` → `UserModel`.
- `user.mapper.ts` → `mapUserToResponse`.

## Relaciones

[[03-domains/auth/index]] · [[03-domains/profiles/index]] · [[03-domains/membership/index]]
