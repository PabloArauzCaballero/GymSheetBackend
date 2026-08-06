---
type: integration
status: verified
last_reviewed: 2026-08-06
source_revision: 27f3fd2
tags: [backend, integration, catalog]
---

# Integraciones — catálogo

El backend GymSheet integra con **dos** servicios externos salientes (HTTP), ambos con allowlist de
host (defensa SSRF), HTTPS obligatorio, timeout acotado y sin credenciales en URL. No hay integración
entrante por agentes de IA ni broker de mensajería externo (ver alcance en
`BACKEND_AUDIT_HARDENING_AND_ACTION_PLAN.md` §0 y [ADR-0005]).

## Integraciones salientes

| Integración | Propósito | Dirección | Trigger | Habilitación | Estado |
|---|---|---|---|---|---|
| **Notification gateway** (WhatsApp) | Entrega de notificaciones (recordatorios de membresía) | Saliente HTTP POST | `worker-notifications` al procesar `notifications.delivery` | `NOTIFICATION_DELIVERY_PROVIDER=HTTP_GATEWAY` + URL/secret | VERIFICADO |
| **Exercises dataset** (import) | Sincroniza catálogo de ejercicios + media pública | Saliente HTTP GET | `worker-exercises-dataset` / comando `db:sync:workoutkata` | `EXERCISES_DATASET_ENABLED=true` | VERIFICADO |

## Proveedores de entrega de notificaciones

`NotificationAdapterFactory` selecciona el adapter por canal y por `NOTIFICATION_DELIVERY_PROVIDER`:

- `IN_APP` → `InAppNotificationAdapter` (sin salida de red; persiste en BD).
- `HTTP_GATEWAY` → `HttpGatewayNotificationAdapter` (gateway externo real).
- `MOCK` → `MockNotificationAdapter` (**prohibido en producción**, bloqueado por `env.ts`).

## Dependencias no-integración (contexto)

- **PostgreSQL 16**: almacén primario y cola (outbox). No es integración externa.
- **Redis** (opcional): contadores de rate limiting; efímero. Ver
  [[../05-data/data-architecture]].

## Detalle por integración

- Notification gateway: [[notification-gateway/overview]] · [[notification-gateway/authentication]] ·
  [[notification-gateway/contracts]] · [[notification-gateway/retries-timeouts]] ·
  [[notification-gateway/failure-modes]]
- Exercises dataset: [[exercises-dataset/overview]] · [[exercises-dataset/contracts]] ·
  [[exercises-dataset/failure-modes]]

## Wikilinks

[[../03-domains/notifications/index]] · [[../03-domains/integration/index]] ·
[[../07-async-processing/workers]] · [[../08-security/secrets-management]]

[ADR-0005]: ../../../decisions/ADR-0005-messaging-transactional-outbox.md
