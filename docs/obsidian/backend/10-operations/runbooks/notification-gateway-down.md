---
type: runbook
status: verified
last_reviewed: 2026-08-06
source_revision: 27f3fd2
tags: [backend, operations, runbook, notifications, gateway]
---

# Runbook — gateway de notificaciones caído

- **Síntoma:** las notificaciones no se entregan; `worker-notifications` loguea
  `notification_delivery.failed`; crece `FAILED`/`DEAD_LETTER` en `notifications.delivery`.
- **Impacto:** recordatorios de membresía (WhatsApp) no llegan. El resto del sistema y el canal
  `IN_APP` siguen funcionando.
- **Severidad:** media-alta.

## Señales

- `notification_delivery.failed` con `errorName` de red/HTTP.
- `gym_sheet_outbox_jobs{queue="notifications.delivery",status="FAILED"|"DEAD_LETTER"}` creciente.
- `delivery_attempt` con `provider:'UNAVAILABLE'`.

## Diagnóstico

```bash
docker compose logs --tail=200 worker-notifications | grep notification_delivery
curl -s http://localhost:3001/api/v1/health/metrics | grep 'notifications.delivery'
```

Clasificar el fallo (ver [[../../06-integrations/notification-gateway/failure-modes]]):

- Timeout (`NOTIFICATION_GATEWAY_TIMEOUT_MS`) → gateway lento/red.
- HTTP no-2xx → problema del gateway o firma HMAC rechazada.
- `… is not configured.` → falta `NOTIFICATION_GATEWAY_URL`/`_SECRET`.
- Host no allowlisted / no HTTPS → arranque ya habría fallado (`env.ts`).

## Mitigación

- Gateway externo caído: esperar; el backoff (tope 1 h) reintenta hasta `max_attempts`. No requiere
  acción de código.
- Config errónea: corregir URL/secret/allowlist y redeploy (`env.ts` valida al arrancar).
- Reloj desincronizado (firma HMAC con timestamp) → sincronizar NTP.
- Si urge, `IN_APP` sigue disponible como canal alterno (INFERIDO: cambio de canal es decisión de
  negocio/config, no automático).

## Recuperación

Restablecido el gateway, los jobs `FAILED` se reintentan al vencer su `available_at` y pasan a `SENT`
(la notificación no se reenvía si ya es terminal; idempotencia por `X-Idempotency-Key`). Los
`DEAD_LETTER` requieren triage manual ([[outbox-backlog]]).

## Validación

`delivery_attempt` `SENT`; notificaciones a `SENT`; `FAILED`/`DEAD_LETTER` estabilizados.

## Rollback

Si un cambio de config del gateway rompió la entrega, revertir esa variable / release
([[../rollback]]).

## Escalamiento

Gateway externo con caída prolongada → contactar al proveedor del gateway. `DEAD_LETTER` acumulado →
[[outbox-backlog]] y decisión de reenvío manual.

## Prevención

- Alertas de `FAILED`/`DEAD_LETTER` y backlog age.
- Timeout y allowlist ya configurados; secreto rotado por gestor de secretos
  ([[../../08-security/secrets-management]]).
- Prueba de resiliencia: apuntar la URL a un host allowlisted inalcanzable y observar el ciclo
  FAILED→recuperación (`docs/operations/docker-and-messaging.md` §Resilience testing).

## Referencias

[[../../06-integrations/notification-gateway/overview]] ·
[[../../06-integrations/notification-gateway/failure-modes]] ·
[[../../06-integrations/notification-gateway/retries-timeouts]] · [[outbox-backlog]]
