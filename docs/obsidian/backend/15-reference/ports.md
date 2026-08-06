---
title: "Referencia — Puertos"
type: reference
status: inferred
last_reviewed: "2026-08-06"
tags: [backend, reference, ports]
---

# Puertos

| Puerto | Servicio | Fuente | Estado |
|---|---|---|---|
| `$PORT` / `$API_PORT` (típ. 3000) | API HTTP | `.env.example` | VERIFICADO (variable) |
| 5432 | PostgreSQL (contenedor) | `docker-compose.yml` | INFERIDO — confirmar en compose |
| 5433 | PostgreSQL para E2E | `CLAUDE.md` (`yarn test:e2e`) | VERIFICADO |
| 6379 | Redis | `docker-compose.yml` | INFERIDO — confirmar en compose |

> [!question] Pendiente
> Confirmar mapeos de puertos exactos en `docker-compose.yml` / `docker-compose.dev.yml`. Ver [[10-operations/deployment]].
