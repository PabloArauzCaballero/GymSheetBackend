---
title: "Quick start"
type: overview
status: verified
owner: unknown
criticality: medium
last_reviewed: "2026-08-06"
source_revision: "27f3fd2"
tags: [backend, documentation, quickstart]
related: ["[[12-development/local-setup]]", "[[15-reference/commands]]"]
---

# Quick start

> Comandos **VERIFICADOS** en `CLAUDE.md`/`package.json`. Requiere Node + yarn + Docker.

## 1. Prerrequisitos

- Node.js (ver `.nvmrc`/`engines` si existe), **yarn**, Docker + Docker Compose, PostgreSQL 16 (o vía compose).

## 2. Instalar

```bash
yarn install --frozen-lockfile
```

## 3. Configurar variables

```bash
cp .env.example .env   # editar valores; NUNCA versionar .env
```

Ver [[15-reference/environment-variables]]. Variables mínimas: `DB_*`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`.

## 4. Levantar infraestructura + servicios (recomendado)

```bash
docker compose up -d --build   # postgres, redis, migrate, api, workers
```

Para desarrollo: `docker-compose.dev.yml`.

## 5. Migraciones (si se corre fuera de compose)

```bash
yarn migration:up      # aplicar
yarn migration:down    # revertir última
```

## 6. Datos de arranque (seeds)

Seeds de admin/mock por env (`SEED_ADMIN_*`, `SEED_MOCK_PASSWORD`). Ver `docs/dev-membership-seeds.md`.

## 7. Ejecutar (fuera de Docker)

```bash
yarn build && node dist/main.js   # o el script start correspondiente
```

## 8. Verificar salud

```bash
curl localhost:$PORT/health/live     # liveness (sin dependencias)
curl localhost:$PORT/health/ready    # readiness (DB, migraciones, Redis)
```

## 9. Pruebas

```bash
yarn lint          # ESLint 9 flat, type-aware
yarn type-check    # tsc --noEmit
yarn test          # unitarias (jest --runInBand)
yarn test:e2e      # e2e — requiere PostgreSQL en :5433
```

## 10. Detener y limpiar

```bash
docker compose down          # conserva volúmenes
docker compose down -v       # elimina volúmenes (DESTRUCTIVO)
```

> [!warning] Verificado vs inferido
> Comandos de `package.json` y `CLAUDE.md` son VERIFICADOS. Los pasos de arranque fuera de Docker pueden depender de scripts específicos; confirmar en `package.json`.
