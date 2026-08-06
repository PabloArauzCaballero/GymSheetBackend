---
title: "Datos — Índice"
type: data
status: verified
last_reviewed: "2026-08-06"
tags: [backend, data, index]
---

# 05 · Datos — Índice

Propósito: modelo de datos (conceptual/lógico/físico), entidades, relaciones, diccionario, estados y persistencia. Fuente física primaria: migraciones `src/database/migrations/`; `docs/db/schema.sql` es **parcial** (ver [[14-audits/contradictions]] DOC-02).

## Modelos y arquitectura
- [[05-data/data-architecture]] · [[05-data/data-stores]]
- [[05-data/conceptual-data-model]] · [[05-data/logical-data-model]] · [[05-data/physical-data-model]]
- [[05-data/entity-relationship-model]]

## Catálogos
- [[05-data/entity-catalog]] (44 modelos) · [[05-data/relationship-catalog]] (72 FKs) · [[05-data/data-dictionary]]
- [[05-data/crud-matrix]]

## Comportamiento y persistencia
- [[05-data/state-and-lifecycle-models]] · [[05-data/transactions]] · [[05-data/indexing-and-query-patterns]]
- [[05-data/migrations]] · [[05-data/sensitive-data]]

## Entidades críticas
- [[05-data/entities/user|user]] · [[05-data/entities/membership|membership]] · [[05-data/entities/entitlement|entitlement]] · [[05-data/entities/access-credential|access-credential]] · [[05-data/entities/outbox-job|outbox-job]] · [[05-data/entities/notification|notification]]

## Riesgos de datos
Ver [[14-audits/risks-register]] (DATA-01..06).
