---
title: "Mapa de impacto de dependencias"
type: audit
status: verified
last_reviewed: "2026-08-06"
tags: [backend, change-impact]
---

# Mapa de impacto de dependencias

El grafo de dependencias entre módulos (acíclico, sin `forwardRef`) está en [[02-architecture/dependency-map]]. Nodos de mayor propagación:

- `integration` (outbox/domain-events): dependencia de ~5 módulos → cambios de contrato de evento impactan a todos los consumidores (ARCH-02).
- `membership`: importa 5 módulos (agregador del alta de socio) (ARCH-03).
- `common`: transversal (guards, filtros, rate limit) → afecta a todos los endpoints.
- `database/migrations`: cambios de esquema irreversibles.

Ver [[13-change-impact/high-risk-components]] · [[14-audits/risks-register]].
