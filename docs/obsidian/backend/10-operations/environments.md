---
type: operations
status: verified
last_reviewed: 2026-08-06
source_revision: 27f3fd2
tags: [backend, operations, environments]
---

# Entornos

`NODE_ENV` ∈ `development` | `test` | `production` (default `development`, validado en
`src/config/env.ts`).

| Entorno | Cómo se levanta | Rasgos |
|---|---|---|
| **development** | `yarn start:dev` (local) o `docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build` | Hot reload (API `nest --watch`, workers `node --watch`+ts-node); root FS no read-only; Redis opcional (`REDIS_REQUIRED=false`); Postgres publicado para tooling; logs verbose |
| **test** | `yarn test` (unit, `--runInBand`) · `yarn test:e2e` (requiere PostgreSQL en :5433) | Instancia de Postgres propia en 5433, no colisiona con dev |
| **production** | `docker compose up -d --build` (target `runtime`) | Imagen slim multi-stage `node:22-alpine`, non-root, root FS read-only, `no-new-privileges`, `tini` PID 1; `REDIS_REQUIRED=true`; `MOCK`/`ACCESS_MOCK` prohibidos |

## Reglas de entorno reforzadas por `env.ts` (`superRefine`)

- `ACCESS_MOCK_ENABLED=true` prohibido en `production`.
- `NOTIFICATION_DELIVERY_PROVIDER=MOCK` prohibido en `production`.
- `HTTP_GATEWAY` exige URL+secret, HTTPS y host allowlisted.
- `REDIS_REQUIRED=true` exige `REDIS_URL` (evita rate limiting per-proceso en multi-instancia).
- `JWT_ACCESS_SECRET` ≠ `JWT_REFRESH_SECRET`; `DB_POOL_MIN ≤ DB_POOL_MAX`; `BUSINESS_TIME_ZONE`
  IANA válida.

## Configuración por entorno

- Variables: [[configuration]] y [[../15-reference/environment-variables]].
- Compose prod vs dev: [[deployment]] y `docs/operations/docker-and-messaging.md`.

## Wikilinks

[[configuration]] · [[deployment]] · [[scaling]] · [[../15-reference/environment-variables]]
