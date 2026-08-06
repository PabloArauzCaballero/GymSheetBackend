---
type: data
status: verified
last_reviewed: 2026-08-06
source_revision: 27f3fd2
tags: [backend, data]
---

# Datos sensibles

Clasificación de datos personales (PII), credenciales, biométricos y financieros. Base para políticas
de acceso, retención, minimización en logs y consentimiento.

## Credenciales y secretos

| Dato | Ubicación | Forma almacenada | Riesgo | Control |
|---|---|---|---|---|
| Contraseña de usuario | `usuarios.password_hash` | Hash bcrypt (nunca en claro) | Alto | Nunca se expone en mappers/DTOs; no se registra en logs |
| PIN de acceso | `access_control.credentials.pin_hash` | Hash | Alto | CHECK de material; solo tipo PIN; jamás en claro |
| Tokens/secretos de gateway | Variables de entorno | No en base | Alto | Solo `.env` (ignorado); solo `.env.example` versionado |

## Biométricos (categoría especial)

| Dato | Ubicación | Forma almacenada | Nota |
|---|---|---|---|
| Referencia biométrica facial/huella | `access_control.credentials.external_reference` | **Solo referencia externa**, no plantilla | La plantilla vive en el proveedor externo (boundary ADR-0002). CHECK exige `consent_recorded_at` |
| Consentimiento biométrico | `credentials.consent_version`, `consent_recorded_at` | Versión + fecha | Obligatorio para FACE/FINGERPRINT (CHECK material) |

> El backend **no almacena plantillas biométricas**, solo un identificador opaco del proveedor. Esto
> reduce el impacto de una fuga, pero `external_reference` sigue siendo dato de categoría especial.

## PII

| Dato | Ubicación | Sensibilidad |
|---|---|---|
| Email | `usuarios.email` (UK) | PII directa |
| Nombre completo | `usuarios.nombre_completo` | PII directa |
| Teléfono | `membership.customer_profiles.phone_number` | PII directa (índice parcial) |
| Datos de salud/físicos | `perfiles_antropometricos` (edad, peso, estatura, objetivo) | PII sensible (salud) |
| Historial de peso | `profile.body_measurements` | PII sensible (salud), append-only |
| Onboarding (metas, consideraciones físicas, consentimientos de salud) | `profile.onboarding` | PII sensible (salud) |
| Contenido de notificaciones | `notifications.messages.subject/body` | Puede contener PII |
| Payload de eventos/outbox | `domain_events.payload`, `outbox_jobs.payload` | Puede contener PII; evitar volcarlo en logs |

## Financiero

| Dato | Ubicación | Nota |
|---|---|---|
| Precio de plan | `membership.plans.price_amount/currency` | Comercial; CHECK moneda ISO |
| Costo de mantenimiento | `facilities.maintenance_events.cost_amount/currency` | Operativo |
| Intents de pago / referencias externas | `membership.intents`, `memberships.external_reference` | Referencias, no datos de tarjeta (no se almacenan medios de pago) |

## Consentimiento

- **Biometría:** `credentials.consent_version` + `consent_recorded_at` (CHECK obligatorio).
- **Notificaciones externas (HTTP_GATEWAY/WhatsApp):** `notifications.preferences.external_delivery_consent_at`
  + `consent_version` (CHECK: canal externo exige consentimiento).
- **Salud/datos onboarding:** `onboarding.consent_health`, `consent_data`.

## Reglas operativas (de `.claude/rules/30-security.md` y `40-observability.md`)

- No registrar secretos, tokens, PII ni payloads completos en logs.
- Errores 5xx redactan detalles técnicos en producción.
- Historiales append-only (`domain_events`, `status_history`) → no borrado ni sobrescritura de datos
  crudos; considerar en políticas de retención/derecho al olvido (posible tensión — evaluar).

## Referencias

- [[data-dictionary]] · [[entities/access-credential]] · [[entities/user]] · ADR-0002
