---
title: "Atributos de calidad"
type: architecture
status: verified
last_reviewed: "2026-08-06"
source_revision: "27f3fd2"
tags: [backend, architecture]
---

# Atributos de calidad

Cómo la arquitectura soporta cada atributo y con qué evidencia.

| Atributo | Táctica | Evidencia |
|---|---|---|
| **Consistencia** | Mutación + evento + outbox en una transacción; historial append-only por triggers | `event-driven-production-audit.md` |
| **Fiabilidad (async)** | Claim `SKIP LOCKED`, fencing lease, backoff, dead-letter; poll error no mata proceso | `src/workers/*.runner.ts` |
| **Idempotencia** | `sourceEventId` único, dedup key en outbox, consumidor idempotente | ADR-0002, ADR-0005 |
| **Seguridad** | JWT HS256 revalidado, propiedad por recurso (404), Zod anti mass-assignment, secretos por env | [[08-security/security-overview]] |
| **Disponibilidad** | Readiness 503 si esquema desfasado o Redis requerido caído; liveness sin dependencias | `health.controller.ts` |
| **Resiliencia rate-limit** | `ResilientThrottlerStorage`: caída de Redis degrada a memoria, no tumba el API | `src/common/redis/` |
| **Observabilidad** | Logs `event` + correlation ID; métricas Prometheus; workers con `flushLogs()` | [[09-observability/observability-overview]] |
| **Rendimiento** | Listados paginados e indexados, pool y statement timeout por entorno, lotes acotados | `.claude/rules/50-performance.md` |
| **Escalabilidad** | API sin estado (rate limit en Redis compartido); workers escalan por proceso | `docker-compose.yml` |
| **Mantenibilidad** | Capas controller/service/repo, grafo de módulos acíclico, mappers | [[02-architecture/module-boundaries]] |
| **Portabilidad de proveedor** | Fronteras por adapter (PACS, gateway) | ADR-0002 |

## Tensiones (trade-offs)

- **At-least-once, no exactly-once**: se acepta reproceso a cambio de simplicidad; exige consumidores
  idempotentes.
- **Monolito modular**: despliegue y consistencia simples a costa de escalar todo el código junto
  (mitigado separando API de workers).
- **PostgreSQL como bus**: sin operar un broker, pero la DB es punto único de coordinación
  (ver [[02-architecture/architecture-risks]]).

Riesgos derivados: [[02-architecture/architecture-risks]].
