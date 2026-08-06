---
title: "Cobertura documental"
type: audit
status: verified
criticality: medium
last_reviewed: "2026-08-06"
source_revision: "27f3fd2"
tags: [backend, audit, coverage]
---

# Cobertura documental

> Método: conteo de artefactos detectados vs documentados (rev `27f3fd2`). 153 notas generadas en la bóveda.

| Área | Detectado | Documentado | Cobertura | Clase |
|---|---:|---:|---|---|
| Arquitectura (vistas) | — | 22 notas (incl. C4) | Alta | 91–100% |
| Módulos/dominios | 15 | 15 + catálogo | Alta | 100% |
| API (rutas) | 115 | 115 catalogadas; 13 grupos + detalle auth | Buena | 76–90% (detalle por endpoint parcial) |
| Datos: entidades | 44 modelos + 1 tabla | 44 catalogadas; 6 fichas + diccionario crítico | Buena | 76–90% |
| Datos: relaciones | 72 FKs | 72 en catálogo | Alta | 91–100% |
| Async/outbox/workers | 4 workers | 8 notas | Alta | 91–100% |
| Integraciones | 2 (gateway, dataset) | 8 notas | Alta | 100% |
| Seguridad | — | 11 notas + threat model | Buena | 76–90% |
| Observabilidad | — | 8 notas | Buena | 76–90% |
| Operación/runbooks | — | 14 notas (5 runbooks) | Buena | 76–90% |
| Pruebas | 34 unit + 2 e2e | 2 notas | Media | 51–75% |
| Desarrollo local | — | 1 nota | Media | 51–75% |

## Detalle por endpoint

Catálogo maestro completo (115 rutas) en [[04-api/index]]. Fichas de endpoint detalladas: solo `POST /auth/login` y `POST /auth/refresh`. El resto se documenta a nivel de grupo (`04-api/rest/*`). Ampliar bajo demanda con [[templates/endpoint-template]].

## Vacíos conocidos

- Fichas de endpoint individuales (más allá de auth).
- SLIs/SLOs formales, tracing distribuido ([[09-observability/slo-sli-sla]], [[09-observability/tracing]]).
- Cobertura de pruebas instrumentada ([[11-quality/coverage-gaps]]).
- `schema.sql` parcial (ver [[14-audits/contradictions]] DOC-02).

Ver [[_meta/unresolved-items]] · [[14-audits/technical-debt]].
