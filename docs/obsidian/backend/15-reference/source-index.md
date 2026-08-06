---
title: "Referencia — Índice de fuentes y trazabilidad"
type: reference
status: verified
last_reviewed: "2026-08-06"
source_revision: "27f3fd2"
tags: [backend, reference, traceability]
---

# Índice de fuentes y trazabilidad

> Puentes clave código → nota. Rutas relativas al repo.

## Entrypoints y wiring

| Fuente | Nota |
|---|---|
| `src/main.ts`, `src/app.module.ts` | [[02-architecture/architecture-overview]] |
| `src/config/` (env Zod) | [[10-operations/configuration]], [[15-reference/environment-variables]] |
| `src/common/` (guards, filtros, request-id) | [[08-security/authorization]], [[09-observability/correlation-ids]] |
| `src/database/migrations/` | [[05-data/migrations]] |
| `src/workers/` | [[07-async-processing/workers]] |
| `src/modules/integration/` | [[07-async-processing/events]], [[15-reference/events-catalog]] |

## Dominios

| Módulo | Nota |
|---|---|
| auth | [[03-domains/auth/index]] |
| membership | [[03-domains/membership/index]] |
| access-control | [[03-domains/access-control/index]] |
| training / workouts | [[03-domains/training/index]] · [[03-domains/workouts/index]] |
| exercises | [[03-domains/exercises/index]] |
| profiles | [[03-domains/profiles/index]] |
| notifications | [[03-domains/notifications/index]] |
| facilities / equipment | [[03-domains/facilities/index]] · [[03-domains/equipment/index]] |
| users / export / health / integration | [[03-domains/index]] |

## Contratos y esquema

| Fuente | Nota |
|---|---|
| `docs/endpoints/openapi.yaml` | [[04-api/index]] |
| `docs/db/schema.sql` (parcial) | [[05-data/physical-data-model]] |
| ADR-0001..0005 (`docs/decisions/`) | [[02-architecture/architecture-overview]] |

## Trazabilidad (ejemplos)

| Origen | Relación | Destino |
|---|---|---|
| `POST /auth/login` | invoca | `AuthService` → `UserRepository` → tabla `usuarios` |
| Renovación de membresía | escribe | `memberships` + `membership_status_history` (+ outbox: ver AUD-01) |
| Evento de dispositivo | encola | `device_events` → worker-access → `access_control.decisions` |
| Recordatorio de membresía | encola | `outbox_jobs` → worker-notifications → gateway |

Ver [[00-home/navigation-map]] para la trazabilidad completa por sección.
