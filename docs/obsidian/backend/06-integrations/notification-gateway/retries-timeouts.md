---
type: integration
status: verified
last_reviewed: 2026-08-06
source_revision: 27f3fd2
tags: [backend, integration, notifications, retry, timeout]
---

# Notification gateway — reintentos y timeouts

## Timeout de la petición

`HttpGatewayNotificationAdapter` usa `AbortController` + `setTimeout(NOTIFICATION_GATEWAY_TIMEOUT_MS)`
(default **10.000 ms**, rango 1.000–60.000). Al vencer, aborta el `fetch`; el error se normaliza a
`ServiceUnavailableException('Notification gateway request failed.')`. El `timeout` se limpia en
`finally`.

## Reintentos (a nivel de cola, no del adapter)

El adapter **no** reintenta internamente: un fallo lanza excepción y el reintento lo gobierna la cola
outbox. Al fallar el job (`NotificationDeliveryRunner.process` → `outbox.fail`):

- Backoff exponencial en `available_at`: `min(3600, 2^min(intento,10)·5)` s (tope **1 h**).
- Hasta `max_attempts` (default 5); luego `DEAD_LETTER`.
- Ver [[../../07-async-processing/retry-and-dead-letter]].

## Interacción con quiet hours

El primer intento respeta `available_at` calculado por `NotificationScheduleService.nextAllowedAt`
(quiet hours del destinatario en `BUSINESS_TIME_ZONE`). Los reintentos por backoff pueden caer fuera
de esa ventana (INFERIDO: el backoff prima sobre quiet hours en reintentos).

## Presupuesto operativo

Con default 5 intentos y tope 1 h, un gateway caído tarda como mucho ~ (5+15+…) → llega al tope y un
job satura en horas antes de `DEAD_LETTER`. Alertar por `FAILED`/`DEAD_LETTER` y por
`gym_sheet_outbox_backlog_age_seconds`. Runbook: [[failure-modes]] y
[[../../10-operations/runbooks/notification-gateway-down]].
