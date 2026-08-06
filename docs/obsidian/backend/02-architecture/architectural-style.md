---
title: "Estilo arquitectónico"
type: architecture
status: verified
last_reviewed: "2026-08-06"
source_revision: "27f3fd2"
tags: [backend, architecture]
---

# Estilo arquitectónico

## Decisión

**Monolito modular + workers + transactional outbox.** Una sola base de código y una sola imagen
Docker que se despliega como varios procesos: la API HTTP y cuatro workers de background. No hay
microservicios ni broker de mensajería externo (ADR-0005).

Reutiliza y condensa `docs/architecture/architecture.md`.

## Capas (por módulo)

`controller` (transporte HTTP) → `service` (reglas de dominio + verificación de propiedad) →
`repository` (acceso a datos Sequelize). Regla del repo (`.claude/rules/10-backend-architecture.md`):
no mezclar transporte con negocio; nunca devolver modelos ORM directos (usar `*.mapper.ts`).

## Principios estructurales

- **Un comando de negocio = una transacción.** Todas las escrituras obligatorias (mutación del
  agregado + historial + evento de dominio append-only + outbox cuando hay consumidor) se confirman
  o revierten juntas. Ver `docs/architecture/event-driven-production-audit.md`.
- **Asincronía solo por outbox.** El trabajo diferido va a `integration.outbox_jobs` + workers con
  reintentos finitos, backoff y dead-letter. Sin colas externas sin ADR.
- **Entrega at-least-once + consumidor idempotente.** No se afirma exactly-once; se usan claves de
  deduplicación y fencing por lock.
- **Fronteras por adapter.** El hardware de acceso físico y los proveedores externos se aíslan tras
  contratos canónicos (ADR-0002), no con condicionales dispersos.

## Por qué no microservicios (INFERIDO)

El dominio es cohesivo, comparte una base PostgreSQL transaccional y el equipo es pequeño; la
separación por procesos (API vs workers) ya aporta aislamiento de fallos y escalado independiente sin
el coste operativo de servicios distribuidos. La consistencia fuerte dentro del límite transaccional
sería difícil de preservar troceando en servicios.

Ver [[02-architecture/architecture-overview]], [[02-architecture/module-boundaries]].
