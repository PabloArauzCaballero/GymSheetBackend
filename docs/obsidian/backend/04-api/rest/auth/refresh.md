---
title: "POST /auth/refresh"
type: api
status: verified
last_reviewed: "2026-08-06"
source_revision: "27f3fd2"
tags: [backend, api]
---

# POST /auth/refresh

> [!warning] Endpoint NO implementado (INFERIDO del requisito, ausente en el código)
> En la revisión `27f3fd2` **no existe** ninguna ruta `POST /auth/refresh` ni lógica
> de refresh en `src/modules/auth`. Esta nota documenta la brecha, no un endpoint
> real.

## Estado real

- `AuthController` solo expone `register`, `login`, `me`.
- `AuthService` solo implementa `register` y `login`; ambos emiten **solo**
  `accessToken`.
- El entorno **sí** define `JWT_REFRESH_SECRET` (min 64) y `JWT_REFRESH_EXPIRES_IN`
  (def. `7d`), y `env.ts` exige que difieran del par de access
  (`superRefine`). Es decir, la configuración está preparada pero **no cableada**.
- OpenAPI (`docs/endpoints/openapi.yaml`) **tampoco** documenta `/auth/refresh`.

## Contrato esperado (cuando se implemente) — INFERIDO

Un flujo de refresh coherente con el stack sería: cliente presenta un refresh token
(HS256 con `JWT_REFRESH_SECRET`), el backend lo valida, revalida el principal contra
PostgreSQL y emite un nuevo access token (y opcionalmente rota el refresh). Debería:

- llevar rate limit estricto como el resto de auth ([[04-api/rate-limits]]);
- devolver el mismo envelope `{ ok, data: { accessToken, tokenType, user } }`;
- reflejarse en OpenAPI y en la colección Postman en el mismo PR.

## Acción recomendada

Implementar el endpoint o retirar `JWT_REFRESH_*` del entorno para evitar la
falsa señal de que existe refresh. Registrar como hallazgo abierto.

Relacionado: [[index]] · [[login]] · [[04-api/authentication]]
