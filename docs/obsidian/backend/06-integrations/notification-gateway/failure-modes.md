---
type: integration
status: verified
last_reviewed: 2026-08-06
source_revision: 27f3fd2
tags: [backend, integration, notifications, failure-modes]
---

# Notification gateway — modos de fallo

| Modo de fallo | Detección | Efecto | Mitigación |
|---|---|---|---|
| Gateway no configurado (falta URL/secret) | `deliver` lanza `ServiceUnavailableException` | El job falla y reintenta | Configurar `NOTIFICATION_GATEWAY_URL`/`_SECRET`; `env.ts` ya lo exige con `HTTP_GATEWAY` |
| Timeout de red | `AbortController` tras `NOTIFICATION_GATEWAY_TIMEOUT_MS` | Excepción → fallo del job → backoff | Ajustar timeout; revisar red saliente |
| HTTP no-2xx | `!response.ok` | Excepción con el status → fallo del job | Revisar logs del gateway; validar contrato |
| Error DNS / conexión | `fetch` rechaza | `ServiceUnavailableException('… request failed.')` | Verificar allowlist/host; DNS |
| Redirección inesperada | `redirect: 'error'` aborta | Fallo del job (mitiga SSRF) | Corregir URL destino |
| Host fuera de allowlist / no HTTPS | `env.ts` falla en arranque | La API/worker no arranca | Corregir `NOTIFICATION_GATEWAY_ALLOWED_HOSTS`/URL |
| Firma HMAC rechazada por el gateway | HTTP no-2xx (INFERIDO) | Fallo del job → reintento | Verificar secreto compartido y reloj (timestamp) |
| Agotados los reintentos | `attempt_count >= max_attempts` | Job `DEAD_LETTER`; notificación `DEAD_LETTER` | Triage manual; ver runbook |

## Aislamiento del fallo

- El fallo del gateway **no** cae al hilo HTTP de la API: ocurre en `worker-notifications`, aislado.
- La notificación persiste su estado (`FAILED`/`DEAD_LETTER`) y un `delivery_attempt` con
  `provider:'UNAVAILABLE'` (`recordFailure`), por lo que el fallo es auditable.
- El resto de canales (`IN_APP`) sigue funcionando aunque el gateway esté caído.

## Señales

- Log: `notification_delivery.failed` (`deadLetter`, `attempt`, `errorName`),
  `notification_delivery.lease_lost_after_delivery`.
- Métrica: `gym_sheet_outbox_jobs{queue="notifications.delivery",status="FAILED"|"DEAD_LETTER"}`,
  `gym_sheet_outbox_backlog_age_seconds{queue="notifications.delivery"}`.

## Runbook

[[../../10-operations/runbooks/notification-gateway-down]] ·
[[../../07-async-processing/retry-and-dead-letter]] · `docs/operations/observability-and-alerts.md`.
