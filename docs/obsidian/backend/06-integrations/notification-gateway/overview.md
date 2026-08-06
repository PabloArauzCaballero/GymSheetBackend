---
type: integration
status: verified
last_reviewed: 2026-08-06
source_revision: 27f3fd2
tags: [backend, integration, notifications, gateway]
---

# Notification gateway — visión general

Gateway HTTP externo para entregar notificaciones (recordatorios de membresía por WhatsApp).
Implementación: `HttpGatewayNotificationAdapter`
(`src/modules/notifications/delivery/http-gateway-notification.adapter.ts`), invocado por
`worker-notifications` a través de `NotificationDeliveryService.deliver`.

## Cuándo se usa

- Solo cuando `NOTIFICATION_DELIVERY_PROVIDER=HTTP_GATEWAY` y el canal de la notificación es
  `HTTP_GATEWAY` (`NotificationAdapterFactory.forChannel`). Canal `IN_APP` no sale a red.
- Disparado por el consumo de la cola `notifications.delivery` (ver
  [[../../07-async-processing/queues]]).

## Configuración (`NOTIFICATION_GATEWAY_*`)

| Variable | Rol | Notas |
|---|---|---|
| `NOTIFICATION_DELIVERY_PROVIDER` | `IN_APP` / `HTTP_GATEWAY` / `MOCK` | `MOCK` prohibido en producción |
| `NOTIFICATION_GATEWAY_URL` | Endpoint del gateway | **HTTPS** + host en allowlist (validado en `env.ts`) |
| `NOTIFICATION_GATEWAY_SECRET` | Secreto HMAC | min 32 chars; nunca versionado |
| `NOTIFICATION_GATEWAY_ALLOWED_HOSTS` | Allowlist de host (anti-SSRF) | el host de la URL debe estar aquí |
| `NOTIFICATION_GATEWAY_TIMEOUT_MS` | Timeout de la petición | default 10.000 ms (1.000–60.000) |
| `WHATSAPP_MEMBERSHIP_PHONE` | Teléfono de negocio | requerido; regex `\d{8,15}` |

`env.ts` (`superRefine`) exige, con `HTTP_GATEWAY`: URL y secret presentes, esquema HTTPS y host en
`NOTIFICATION_GATEWAY_ALLOWED_HOSTS`; de lo contrario el arranque falla.

## Seguridad de la llamada

- HTTPS forzado, `redirect: 'error'` (un redirect aborta la petición → mitiga SSRF por redirección).
- Firma HMAC-SHA256 sobre `timestamp.body` (ver [[authentication]]).
- Sin secretos ni PII en logs (`.claude/rules/40-observability.md`).

Detalle: [[authentication]] · [[contracts]] · [[retries-timeouts]] · [[failure-modes]].

## Wikilinks

[[../../03-domains/notifications/index]] · [[../../07-async-processing/workers]] ·
[[../../08-security/secrets-management]]
