---
title: "Deuda técnica"
type: audit
status: verified
criticality: medium
last_reviewed: "2026-08-06"
source_revision: "27f3fd2"
tags: [backend, audit, tech-debt]
---

# Deuda técnica

> Deuda observada por análisis estático. Ver detalle y evidencia en [[14-audits/risks-register]] y [[14-audits/contradictions]].

| Tema | Descripción | Referencia |
|---|---|---|
| Contrato OpenAPI parcial | 46/115 rutas documentadas | DOC-01 |
| Snapshot de esquema parcial/obsoleto | `schema.sql` cubre 9/44 tablas; `edad` desalineada | DOC-02, DATA-C2 |
| ENUM vs varchar+CHECK | Declaración ORM no llega a la DB | DATA-C1 |
| Refresh token ausente | Config presente, funcionalidad no implementada | SEC-02 |
| Consistencia 403/404 | Distintos módulos difieren | SEC-04 |
| Traducción de errores únicos | UniqueConstraint → 500 en equipment/facilities | DATA-05 |
| Índices faltantes | FKs sin índice (device_events, feature_id) | DATA-01, DATA-02 |
| Re-drive de DLQ manual | Sin endpoint/cron de reenvío | OPS-02 |
| Poda de outbox opt-in | Sin cron por defecto | OPS-03, DATA-04 |
| Observabilidad de cola de acceso | `device_events` fuera de métricas | OPS-01 |
| Cobertura E2E limitada | Solo auth + ownership | [[11-quality/coverage-gaps]] |
| Docs desactualizados | architecture.md, gateway routes(), docker-and-messaging colas | DOC-03..05 |

Ver [[14-audits/risks-register]].
