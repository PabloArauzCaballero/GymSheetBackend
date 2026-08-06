---
type: integration
status: verified
last_reviewed: 2026-08-06
source_revision: 27f3fd2
tags: [backend, integration, notifications, auth, hmac]
---

# Notification gateway — autenticación

El backend autentica cada petición ante el gateway con una **firma HMAC-SHA256** y una marca de
tiempo, además de una clave de idempotencia. No usa OAuth ni bearer estático.

## Esquema de firma

```text
timestamp  = new Date().toISOString()
body       = JSON.stringify({ notificationId, recipientUserId, subject, body, daysRemaining })
signature  = HMAC_SHA256(NOTIFICATION_GATEWAY_SECRET, `${timestamp}.${body}`)  → hex
```

## Cabeceras enviadas

| Cabecera | Contenido |
|---|---|
| `Content-Type` | `application/json` |
| `X-GymSheet-Timestamp` | `timestamp` ISO-8601 (entra en la firma → anti-replay) |
| `X-GymSheet-Signature` | `sha256=<hex>` |
| `X-Idempotency-Key` | `job.deduplication_key` (dedup en el gateway) |

## Secreto

- `NOTIFICATION_GATEWAY_SECRET` (min 32 chars) solo por variable de entorno; nunca en repo ni logs.
  Ver [[../../08-security/secrets-management]].
- Si falta URL o secret, el adapter lanza `ServiceUnavailableException('Notification gateway is not
  configured.')` (no revela detalles).

## Verificación esperada en el receptor (INFERIDO)

El gateway debe recomputar el HMAC sobre `timestamp.body` con el mismo secreto, rechazar timestamps
fuera de ventana (anti-replay) y deduplicar por `X-Idempotency-Key`. El contrato exacto del receptor
es externo a este repositorio.

## Wikilinks

[[overview]] · [[contracts]] · [[../../08-security/secrets-management]]
