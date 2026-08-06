---
title: "Componentes de alto riesgo (impacto de cambios)"
type: audit
status: inferred
criticality: high
last_reviewed: "2026-08-06"
tags: [backend, change-impact]
---

# Componentes de alto riesgo

> Priorización por acoplamiento y criticidad (INFERIDO del inventario). Cambiar aquí exige pruebas y revisión de seguridad.

| Componente | Por qué es sensible | Antes de cambiar |
|---|---|---|
| `auth` (JWT, guards) | Toda la autenticación/autorización depende | E2E de auth + revisión SEC |
| `integration` (outbox) | Garantía transaccional de eventos; consumido por 4 workers | Prueba de idempotencia/DLQ |
| `membership` (18 modelos) | Núcleo de negocio; entitlements y estado | Migración compatible + E2E |
| `access-control` | Acceso físico; borde de confianza (ADR-0002) | Revisión de adaptador + auditoría |
| `common` (filtros/middleware/rate limit) | Transversal a todos los endpoints | Regresión amplia |
| `database/migrations` | Cambios de esquema irreversibles | Rollback + backup ([[10-operations/rollback]]) |

Ver [[14-audits/risks-register]] · [[13-change-impact/dependency-impact-map]] (ver [[02-architecture/dependency-map]]).
