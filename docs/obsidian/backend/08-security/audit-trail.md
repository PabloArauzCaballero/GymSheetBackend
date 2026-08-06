---
title: "Rastro de auditoría"
type: security
status: verified
criticality: high
last_reviewed: "2026-08-06"
source_revision: "27f3fd2"
source_files:
  - "src/modules/integration/domain-event.model.ts"
  - "src/modules/membership/membership-status-history.model.ts"
  - "src/modules/access-control/access-decision.model.ts"
tags: [backend, security, audit, traceability]
---

# Rastro de auditoría

> Defensivo. Trazabilidad de acciones sensibles para no repudio e investigación.

## Fuentes de rastro (VERIFICADO)

### `integration.domain_events`
Registro append-only de eventos de dominio publicados por el outbox transaccional (ADR-0005).
Columnas relevantes (`domain-event.model.ts`):

- `event_name`, `event_version`, `aggregate_type`, `aggregate_id`.
- `actor_user_id` — quién originó el cambio.
- `correlation_id`, `causation_event_id`, `trace_id` — encadenamiento y correlación
  (ver [[09-observability/correlation-ids]]).
- `occurred_at`, `payload` (JSONB), metadata (JSONB).

Es el rastro más completo: liga actor + agregado + correlación temporal. Ver
[[03-domains/integration/index]] y ADR-0005.

### `membership.membership_status_history`
Historial de transiciones de estado de membresía (`membership-status-history.model.ts`):

- `membership_id`, `from_status`, `to_status`, `reason`.
- `actor_user_id` — quién ejecutó la transición.
- `occurred_at`, metadata (JSONB).

Permite reconstruir el ciclo de vida de cada membresía y quién la modificó.

### `access_control.decisions`
Decisiones de acceso físico (`access-decision.model.ts`):

- `device_event_id` (único), `user_id`, `decision`, `reason_code`.
- `membership_id`, `staff_profile_id`, `days_remaining`.
- `decided_at`, `policy_version` (`ACCESS_POLICY_VERSION`).

Registra cada resolución de acceso con la versión de política aplicada, útil para auditar denegaciones
y cambios de política. Ver [[03-domains/access-control/index]].

## Uso para seguridad

- **No repudio**: `actor_user_id` en eventos e historial vincula acciones a usuarios.
- **Correlación de incidentes**: `correlation_id`/`trace_id` cruzan el rastro con los logs por
  `requestId` (ver [[09-observability/correlation-ids]]).
- **Auditoría de política de acceso**: `policy_version` permite saber bajo qué reglas se decidió.

## Brechas / advertencias

- El rastro **no es criptográficamente inmutable** (sin firma/hash encadenado); su integridad depende
  de los controles de acceso a la base de datos. Un actor con acceso de escritura a la DB podría
  alterarlo (INFERIDO).
- `actor_user_id` es nullable: los eventos originados por el sistema/workers no llevan actor humano;
  correcto por diseño, pero conviene distinguirlos en investigación.

Relacionado: [[09-observability/logging]] · [[08-security/threat-model]].
