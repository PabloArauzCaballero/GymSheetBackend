---
title: "Riesgos de arquitectura"
type: architecture
status: verified
last_reviewed: "2026-08-06"
source_revision: "27f3fd2"
tags: [backend, architecture]
---

# Riesgos de arquitectura

Riesgos estructurales identificados al mapear el sistema. Estado de producción global:
`BACKEND_AUDIT_HARDENING_AND_ACTION_PLAN.md`; registro: [[14-audits/risks-register]].

| ID | Riesgo | Impacto | Mitigación actual | Estado |
|---|---|---|---|---|
| ARCH-1 | **PostgreSQL es SPOF**: fuente de verdad y bus (outbox + claims). Si cae, API y los 4 workers se detienen | Alto | Pool, timeouts, health readiness; backup/restore documentado | Aceptado (monolito) |
| ARCH-2 | **`integration` es hub**: 5 módulos dependen del outbox; un cambio de contrato o bug propaga | Medio | Grafo acíclico, contrato de eventos versionado | Vigilar |
| ARCH-3 | **`membership` muy acoplado**: importa 5 módulos (users, access-credential, facilities, integration, notifications) | Medio | Cohesión real del alta de socio transaccional | Aceptado |
| ARCH-4 | **Redis SPOF blando**: en compose es requerido; su caída no tumba la API (degrada) pero sí endurece dependencia si `REDIS_REQUIRED` | Bajo | `ResilientThrottlerStorage` degrada a memoria | Mitigado |
| ARCH-5 | **Adapter PACS no confirmado**: fabricante/protocolo desconocidos; solo existe mock | Medio | Frontera canónica (ADR-0002), mock bloqueado en prod | Abierto |
| ARCH-6 | **Escala de API limitada en compose**: puerto fijo impide `--scale api=N` sin proxy inverso | Bajo | Documentado; Redis ya hace correcto el rate limit multi-réplica | Conocido |
| ARCH-7 | **Crecimiento del outbox**: `outbox_jobs` mutable puede crecer sin poda | Bajo | `OutboxRetentionService` + comando `db:outbox:prune` (opt-in) | Mitigado |

## No es un riesgo (verificado)

- **Ciclos de dependencia**: no existen. No hay `forwardRef()` en `src`; el grafo de módulos es
  acíclico con hojas `integration`, `users`, `equipment`, `profiles`.

Ver [[02-architecture/quality-attributes]], [[02-architecture/dependency-map]].
