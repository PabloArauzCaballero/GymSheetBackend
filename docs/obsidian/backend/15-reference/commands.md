---
title: "Referencia — Comandos"
type: reference
status: verified
last_reviewed: "2026-08-06"
source_files: ["package.json", "CLAUDE.md"]
tags: [backend, reference, commands]
---

# Comandos

> VERIFICADO en `package.json` / `CLAUDE.md`. Gestor: **yarn**.

| Comando | Propósito |
|---|---|
| `yarn install --frozen-lockfile` | Instalar dependencias |
| `yarn lint` | ESLint 9 (flat config, type-aware) |
| `yarn type-check` | `tsc --noEmit` |
| `yarn test` | Pruebas unitarias (`jest --runInBand`) |
| `yarn test:e2e` | E2E — requiere PostgreSQL en `:5433` |
| `yarn build` | `nest build` → `dist/main.js` |
| `yarn migration:up` / `:down` | Migraciones (ts-node) |
| `yarn audit:prod` | Auditoría de dependencias de producción |
| `docker compose up -d --build` | Pila completa (postgres, redis, migrate, api, workers) |

Ver [[00-home/quick-start]] y [[12-development/local-setup]].
