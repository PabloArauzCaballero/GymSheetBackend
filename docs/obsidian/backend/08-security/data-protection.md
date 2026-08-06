---
title: "Protección de datos"
type: security
status: verified
criticality: high
last_reviewed: "2026-08-06"
source_revision: "27f3fd2"
source_files:
  - "src/common/filters/http-exception.filter.ts"
  - "src/config/env.ts"
  - "docs/operations/observability-and-alerts.md"
tags: [backend, security, pii, privacy]
---

# Protección de datos

> Defensivo. Minimización de exposición de datos personales y detalles técnicos.

## PII manejada

- **Identidad**: email, nombre completo (`users`).
- **Salud/físico**: medidas corporales y antropométricas (`profiles`) — categoría sensible.
- **Acceso físico/biometría**: eventos y decisiones de acceso (`access_control`), tras un adapter
  boundary (ADR-0002). Ver [[03-domains/access-control/index]].
- **Contacto**: teléfono de notificaciones (WhatsApp).

## Controles (VERIFICADO)

- **Redacción de 5xx en producción**: para errores ≥ 500 con `NODE_ENV=production`, el filtro
  reemplaza el mensaje por `"Unexpected server error"` y **omite el stack**
  (`http-exception.filter.ts:135-160`). Los 4xx sí devuelven mensaje (controlado) porque son de
  cliente. La respuesta usa `application/problem+json` con `requestId` para correlación.
- **No devolver modelos ORM**: se usan mappers `*.mapper.ts` para no filtrar columnas internas
  (regla `10-backend-architecture.md`).
- **Política de logs**: no registrar payloads completos, tokens, cabeceras de autorización ni datos
  personales; los logs incluyen `event`, `requestId`, método, ruta normalizada y estado
  (ver [[09-observability/logging]] y `observability-and-alerts.md` §Log policy).
- **Bcrypt** para contraseñas en reposo (ver [[08-security/authentication]]).
- **TLS de base de datos** opcional (`DB_SSL`, `DB_SSL_REJECT_UNAUTHORIZED` por defecto `true`).

## Retención (propuesta, no facto)

`observability-and-alerts.md` propone 30 días de logs buscables y 90 archivados; **debe aprobarse**
contra la política de privacidad/auditoría de la organización antes de desplegar (INFERIDO/pendiente).

## Brechas / advertencias

- La no exposición de PII en logs es **política/convención**, no un mecanismo forzado técnicamente
  (p. ej. no hay un redactor central que garantice el saneamiento de todo objeto logueado) → SEC-5.
  Ver [[08-security/security-findings]].
- No se observa cifrado a nivel de campo para PII sensible (medidas) más allá del cifrado en tránsito
  y en reposo del gestor de base de datos (INFERIDO).

Relacionado: [[09-observability/logging]] · [[08-security/secrets-management]].
