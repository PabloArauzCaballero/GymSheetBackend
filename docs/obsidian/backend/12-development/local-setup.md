---
title: "Desarrollo local"
type: reference
status: verified
criticality: medium
last_reviewed: "2026-08-06"
source_files: ["package.json", "docker-compose.dev.yml", "CLAUDE.md"]
tags: [backend, development]
---

# Desarrollo local

Ver primero [[00-home/quick-start]].

## Prerrequisitos

- Node.js + **yarn**, Docker + Docker Compose, PostgreSQL 16.

## Flujo

1. `yarn install --frozen-lockfile`
2. `cp .env.example .env` y completar (ver [[15-reference/environment-variables]]).
3. Infra dev: `docker compose -f docker-compose.dev.yml up -d` (INFERIDO — confirmar servicios en el archivo).
4. Migraciones: `yarn migration:up`.
5. Seeds: por variables `SEED_*` (ver `docs/dev-membership-seeds.md`).
6. Ejecutar API y verificar `GET /health/ready`.
7. Pruebas: `yarn lint && yarn type-check && yarn test`; E2E con PostgreSQL en `:5433`.

## Convenciones de código

- TypeScript strict, Zod para toda entrada externa, mappers en toda salida (nunca ORM directo), autorización en backend.
- Ver `.claude/rules/` y [[04-api/conventions]].

## Debugging / tareas comunes

- Añadir dependencia: skill `library-selection` + ADR si aplica.
- Verificar cambio de verdad: skill `production-verification`.

Ver [[12-development/troubleshooting]] (pendiente) y [[10-operations/deployment]].
