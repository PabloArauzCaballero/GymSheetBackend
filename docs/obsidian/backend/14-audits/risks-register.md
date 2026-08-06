---
title: "Registro de riesgos"
type: audit
status: verified
criticality: high
last_reviewed: "2026-08-06"
source_revision: "27f3fd2"
tags: [backend, audit, risks]
related: ["[[08-security/security-findings]]", "[[02-architecture/architecture-risks]]"]
---

# Registro de riesgos

> Consolidado del bootstrap (análisis estático, rev `27f3fd2`). **Hechos con evidencia**, separados de recomendaciones. No sustituye a `BACKEND_AUDIT_HARDENING_AND_ACTION_PLAN.md` (F-0xx); lo complementa. Severidad: cualitativa.

## Seguridad

| ID | Hallazgo | Evidencia | Impacto | Sev. | Recomendación | Estado |
|---|---|---|---|---|---|---|
| SEC-01 | `/health/metrics` accesible si falta `METRICS_SCRAPE_TOKEN` (protección opt-in) | `metrics-scrape.guard.ts`, routing health | Exposición de métricas internas | Media | Exigir token o restringir a red privada; fallar si no configurado en prod | Abierto |
| SEC-02 | `POST /auth/refresh` **no existe** pese a `JWT_REFRESH_SECRET`/`_EXPIRES_IN` en env | `src/modules/auth` (sin ruta/servicio) | Sin rotación/revocación de sesión; expectativa incumplida | Media | Implementar refresh+revocación o retirar la config | Abierto |
| SEC-03 | Enumeración de cuentas en `POST /auth/register` (409 "ya existe") | `auth.controller`/`auth.service` | Descubrimiento de emails registrados | Baja | Respuesta uniforme / rate limit reforzado | Abierto |
| SEC-04 | Inconsistencia 403 vs 404 en acceso ajeno: `training`/`exercises` → 403 sobre recurso ajeno existente | servicios de training/exercises | Fuga de existencia de recursos; viola regla del repo (ajeno → 404) | Media | Unificar a 404 por propiedad | Abierto |
| SEC-05 | Propiedad por recurso (BOLA) descentralizada, sin mecanismo central | servicios por módulo | Riesgo de olvido en nuevos endpoints | Media | Auditar por endpoint; helper/guard de propiedad | Abierto (INFERIDO) |
| SEC-06 | SSRF: `resolveMediaBaseUrl` (exercises) no re-valida allowlist (asimétrico con open-media) | exercises dataset media | SSRF acotado (hereda host del dataset) | Baja | Re-validar allowlist simétricamente | Abierto |
| SEC-07 | CORS `credentials:true` + allowlist: riesgo si `CORS_ORIGINS` incluyera comodín | config CORS | Exposición cross-origin con credenciales | Baja | Prohibir comodines con credentials | Abierto |

## Arquitectura

| ID | Hallazgo | Evidencia | Impacto | Sev. |
|---|---|---|---|---|
| ARCH-01 | PostgreSQL es **fuente de verdad y bus** (outbox + claims); su caída detiene API y los 4 workers | outbox en DB, `FOR UPDATE SKIP LOCKED` | SPOF total | Alta |
| ARCH-02 | Módulo `integration` (outbox/domain-events) es dependencia de 5 módulos | `dependency-map` | Propagación de cambios de contrato | Media |
| ARCH-03 | `membership` importa 5 módulos (agregador del alta transaccional) | imports de `membership.module` | Acoplamiento alto | Media |
| ARCH-04 | Redis SPOF blando: `REDIS_REQUIRED=true` en compose, pero degrada a memoria (`ResilientThrottlerStorage`) | throttler storage | Rate limit no compartido si cae | Baja |

## Datos

| ID | Hallazgo | Evidencia | Impacto | Sev. |
|---|---|---|---|---|
| DATA-01 | `access_control.device_events.credential_id` sin índice dedicado | migraciones/schema | Scan en JOIN/borrado por credencial | Media (INFERIDO) |
| DATA-02 | `plan_features.feature_id` y `entitlements.feature_id` sin índice que empiece por `feature_id` | migraciones | "Por feature" hace scan | Baja (INFERIDO) |
| DATA-03 | `entitlements.source_id` referencia polimórfica **sin FK** | modelo/migración | Referencia colgante posible | Media (INFERIDO) |
| DATA-04 | `integration.outbox_jobs` (y `COMPLETED`) crece sin poda si no corre `db:outbox:prune` | outbox-retention | Crecimiento ilimitado | Media |
| DATA-05 | `equipment`/`facilities`: `UniqueConstraintError` no se traduce a 409 → posible 500 | servicios de equipment/facilities | 5xx en vez de 409; rompe idempotencia | Media |
| DATA-06 | `membership.endsOn`: alta usa `durationDays-1`, extensión sin `-1` (posible deriva de 1 día) | `membership.service` | Fechas de fin inconsistentes | Media |

## Operación

| ID | Hallazgo | Impacto | Sev. |
|---|---|---|---|
| OPS-01 | Cola de `worker-access` (`device_events`) **no** aparece en métricas outbox (solo `notifications.delivery`) | Punto ciego de observabilidad en acceso físico | Media |
| OPS-02 | `DEAD_LETTER` sin re-drive automático ni endpoint | Reenvío manual tras fallo | Media |
| OPS-03 | `COMPLETED` append-only sin cron de poda | Crecimiento de tabla | Media |
| OPS-04 | Reintentos por backoff pueden violar quiet hours de notificación | Envíos fuera de horario | Baja (INFERIDO) |
| OPS-05 | Escalar workers > `DB_POOL_MAX` satura el pool; `api` con puerto fijo no escala horizontal directo | Contención/escalado | Media |
| OPS-06 | Refresco de dataset asume single-writer (sin lease) | Solape entre instancias | Baja (INFERIDO) |

## Auditabilidad

| ID | Hallazgo | Impacto | Sev. |
|---|---|---|---|
| AUD-01 | `confirmIntent` (renovación) no emite evento de dominio ni historial | Renovación pagada sin rastro de auditoría | Media |

## Documentación / contradicciones

Ver [[14-audits/contradictions]] (DOC-01..05, contradicciones schema-vs-modelo).

## Referencias

- `BACKEND_AUDIT_HARDENING_AND_ACTION_PLAN.md` (F-012/F-014/F-015/F-016 ya corregidos).
- [[08-security/security-findings]] · [[02-architecture/architecture-risks]] · [[10-operations/runbooks/index]].
