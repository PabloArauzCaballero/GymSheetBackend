---
title: "Contradicciones detectadas"
type: audit
status: verified
criticality: high
last_reviewed: "2026-08-06"
source_revision: "27f3fd2"
tags: [backend, audit, contradictions]
---

# Contradicciones detectadas

> Comparación entre fuentes (código, migraciones, schema.sql, OpenAPI, docs previos). Prioridad de verdad: código/migraciones vigentes > docs.

| ID | Fuente A | Fuente B | Contradicción | Resolución sugerida |
|---|---|---|---|---|
| DOC-01 | Código (115 rutas HTTP) | `docs/endpoints/openapi.yaml` (46 paths) | ~60% de rutas no están en OpenAPI: `routines/*`, admin membership, `access-control`, `access-credential`, `facilities`, `notifications`, `memberships/me`, `mock-access` | Regenerar OpenAPI desde controllers o completarlo. Ver [[04-api/index]] |
| DOC-02 | `docs/db/schema.sql` (9 tablas `public`) | Migraciones (`src/database/migrations`, 44 tablas en 9 schemas) | `schema.sql` es **parcial** (solo Fase 1); 35 tablas existen solo en migraciones | Tratar migraciones como fuente física; regenerar/ampliar `schema.sql` o marcarlo como snapshot parcial. Ver [[05-data/physical-data-model]] |
| DOC-03 | `docs/architecture/architecture.md` | Código (15 módulos + 4 workers) | Doc refleja alcance original (entrenamiento); no lista módulos/workers actuales | Marcar como histórico; la verdad es [[02-architecture/architecture-overview]] |
| DOC-04 | `src/gateway/gateway.service.ts` `routes()` | Módulos registrados en `AppModule` | Lista de rutas del gateway desactualizada (omite membership/access-control/facilities/notifications) | Corregir `routes()` o marcarlo informativo. Endpoint `/gateway/routes` |
| DOC-05 | `docs/operations/docker-and-messaging.md` (catálogo de colas) | Código de consumidores | Solo `notifications.delivery` consume `outbox_jobs`; `worker-access` consume tabla-cola `device_events`; `membership`/`staff`/`equipment`/`access-decision` usan `record()` (solo historial, no encolan) | Actualizar catálogo de colas. Ver [[07-async-processing/events]] |
| DATA-C1 | Modelos (`DataType.ENUM` en `user.role/status`, `anthropometric.goal`) | schema físico (`varchar` + `CHECK`) | La declaración ENUM nunca llega a la DB (no hay `sync`); es cosmética/engañosa | Alinear modelo a `varchar`+CHECK o documentar. Ver [[05-data/physical-data-model]] |
| DATA-C2 | `docs/db/schema.sql` (`perfiles_antropometricos.edad NOT NULL`) | Migración `202607220002` (`DROP NOT NULL`) + modelo (nullable) | `schema.sql` está desactualizado | Regenerar snapshot desde migraciones |

Ver [[14-audits/risks-register]] · [[_meta/unresolved-items]].
