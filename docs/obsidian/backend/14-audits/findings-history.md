---
title: "Historial de hallazgos"
type: audit
status: verified
last_reviewed: "2026-08-06"
tags: [backend, audit, history]
---

# Historial de hallazgos

## 2026-08-06 — bootstrap (rev 27f3fd2)

Primer levantamiento de la bóveda. Hallazgos consolidados en [[14-audits/risks-register]] y [[14-audits/contradictions]].

### Nuevos
- Seguridad: SEC-01..07 (metrics opt-in, refresh ausente, enumeración register, 403/404, BOLA descentralizado, SSRF media, CORS credentials).
- Arquitectura: ARCH-01..04 (PostgreSQL SPOF/bus, hub integration, acoplamiento membership, Redis SPOF blando).
- Datos: DATA-01..06 (índices FK, source_id polimórfico sin FK, outbox sin poda, 409 no traducido, endsOn off-by-one).
- Operación: OPS-01..06 (cola access fuera de métricas, DLQ sin re-drive, COMPLETED sin poda, quiet hours, pool/escalado, dataset single-writer).
- Auditabilidad: AUD-01 (confirmIntent sin evento/historial).
- Documentación: DOC-01..05 + DATA-C1/C2 (OpenAPI parcial, schema.sql parcial/obsoleto, docs arquitectura/gateway/colas desactualizados, ENUM vs varchar+CHECK, edad NOT NULL stale).

### Contexto
- F-012/F-014/F-015/F-016 (de `BACKEND_AUDIT_HARDENING_AND_ACTION_PLAN.md`) ya corregidos; verificado que los workers llaman `flushLogs()` (F-015) y llevan `healthcheck: disable` en Docker (F-016).
