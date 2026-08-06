---
title: "REST · Notifications"
type: api
status: verified
last_reviewed: "2026-08-06"
source_revision: "27f3fd2"
tags: [backend, api]
---

# REST · Notifications

Controlador: `src/modules/notifications/notification.controller.ts`
(`@Controller('notifications')`) · Servicio: `notification.service.ts` · Esquemas:
`notifications.schemas.ts`. **No en OpenAPI.** Propiedad por usuario.

| Método | Ruta | Body/query | Propósito |
|---|---|---|---|
| GET | `/notifications/me` | `notificationListSchema` (query) | Notificaciones propias filtrables |
| PATCH | `/notifications/:id/read` | — | Marca como leída (propia) |
| GET | `/notifications/preferences/me` | — | Preferencias propias |
| PATCH | `/notifications/preferences/me` | `updateNotificationPreferenceSchema` | Actualiza preferencias/consentimientos |

Notas:

- Estados `NotificationStatus`
  (`PENDING`/`SENT`/`FAILED`/`DEAD_LETTER`/`READ`); canales `NotificationChannel`
  (`IN_APP`/`HTTP_GATEWAY`/`MOCK`).
- La entrega la realizan workers (`notification-delivery`) vía outbox; el proveedor
  se fija con `NOTIFICATION_DELIVERY_PROVIDER` (WhatsApp/HTTP gateway con allowlist).
  `MOCK` prohibido en producción (`env.ts`).
- Estos endpoints solo gestionan lectura/preferencias del usuario; el envío no se
  dispara por HTTP directo.

Relacionado: [[04-api/authorization]] · [[03-domains/notifications/index]]
