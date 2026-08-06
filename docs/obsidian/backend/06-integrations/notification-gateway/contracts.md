---
type: integration
status: verified
last_reviewed: 2026-08-06
source_revision: 27f3fd2
tags: [backend, integration, notifications, contract]
---

# Notification gateway — contrato

## Petición

- Método: `POST` a `NOTIFICATION_GATEWAY_URL`.
- `redirect: 'error'` (no sigue redirecciones).
- Cabeceras: ver [[authentication]].
- Cuerpo (JSON):

```json
{
  "notificationId": "uuid",
  "recipientUserId": "uuid",
  "subject": "string",
  "body": "string",
  "daysRemaining": 0
}
```

`notificationId`, `recipientUserId`, `subject`, `body`, `daysRemaining` provienen de la notificación
persistida (`NotificationDeliveryService.deliver` los pasa al adapter).

## Respuesta esperada

| Caso | Interpretación en el backend |
|---|---|
| HTTP 2xx (`response.ok`) | Éxito. `provider='HTTP_GATEWAY'`, `responseCode=<status>` |
| Cabecera `x-provider-message-id` | Se guarda como `providerMessageId` (nullable) |
| HTTP no-2xx | `ServiceUnavailableException('… returned HTTP <status>.')` → fallo del job |
| Error de red / abort por timeout | `ServiceUnavailableException('… request failed.')` → fallo del job |

## Efectos en el backend tras entrega

En transacción (`deliver`): se crea un `delivery_attempt` (`status=SENT`, `provider`,
`providerMessageId`, `responseCode`) y la notificación pasa a `SENT` con `sentAt`. Idempotente: si ya
estaba `SENT`/`READ`, no reenvía. Estados en [[../../05-data/state-and-lifecycle-models]].

## Idempotencia

Clave `X-Idempotency-Key = job.deduplication_key`. El backend además no reenvía notificaciones ya
terminales. Ver [[../../07-async-processing/idempotency]].

## Wikilinks

[[overview]] · [[authentication]] · [[retries-timeouts]] · [[failure-modes]]
