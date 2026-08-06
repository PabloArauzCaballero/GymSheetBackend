---
title: "Modelo de amenazas"
type: security
status: verified
criticality: high
last_reviewed: "2026-08-06"
source_revision: "27f3fd2"
source_files:
  - "src/main.ts"
  - "src/config/env.ts"
  - "src/modules/auth/"
  - "src/modules/access-control/"
tags: [backend, security, threat-model]
---

# Modelo de amenazas

> **Defensivo.** Enumera activos, actores, fronteras, amenazas y controles. No incluye pasos de
> explotación. Ver también [[08-security/abuse-cases]] y [[08-security/security-findings]].

## Activos

| Activo | Sensibilidad | Ubicación |
|---|---|---|
| Credenciales de usuario (hash bcrypt) | Alta | `users` (PostgreSQL) |
| PII: email, nombre, medidas corporales/antropométricas | Alta | `users`, `profiles` |
| Tokens JWT de acceso | Alta | En tránsito / cliente |
| Secretos de servicio (JWT, DB, gateway, métricas) | Crítica | Variables de entorno |
| Datos de membresía y pagos/intents | Alta | dominio `membership` |
| Eventos de acceso físico / biometría (boundary adapter) | Alta | `access_control` |
| Rastro de auditoría (domain_events, status_history, decisions) | Media-Alta | PostgreSQL |

## Actores

- **Usuario cliente autenticado** (rol `CLIENT`): acceso a sus propios recursos.
- **Staff / administrador** (roles con scopes): acceso ampliado por `RolesGuard` + scopes de sucursal.
- **Atacante no autenticado** (ingress público): login/register, endpoints públicos.
- **Sistema de scraping de métricas** (Prometheus): `/health/metrics`.
- **Gateways externos** (WhatsApp, dataset de ejercicios): destinos salientes.
- **Operador de infraestructura**: acceso a env/logs (least privilege esperado).

## Fronteras de confianza

1. Internet → Ingress → API (autenticación + Zod + rate limiting).
2. API → PostgreSQL (consultas parametrizadas, statement timeout).
3. API/Workers → HTTP saliente (allowlist SSRF + HTTPS obligatorio).
4. Proceso API ↔ Procesos worker (comparten DB vía outbox; los workers no exponen HTTP).

## Amenazas → controles → brechas

| Amenaza (STRIDE) | Control encontrado | Brecha / advertencia |
|---|---|---|
| **Spoofing** — suplantar usuario | JWT HS256 firmado, issuer/audience validados, revalidación del principal en DB por request | Sin rotación de refresh ni revocación explícita (SEC-2, INFERIDO) |
| **Spoofing** — enumeración de cuentas | Login gasta `bcrypt.compare` aun sin cuenta; error genérico | Enumeración vía `register` (409 "ya existe") posible (SEC-4) |
| **Tampering** — mass assignment | Zod descarta campos no declarados | Cobertura depende de que cada endpoint use su schema |
| **Tampering** — inyección SQL | Sequelize parametrizado, `UuidParamPipe` valida UUID | Revisar consultas `sequelize.query` crudas (readiness usa literales fijos) |
| **Repudiation** | domain_events con `actor_user_id`/`correlation_id`; status_history con actor; decisions con `policy_version` | Rastro no firmado/inmutable a nivel criptográfico |
| **Information disclosure** — errores 5xx | Redacción en producción (`http-exception.filter.ts`) | Fuera de producción se exponen `message`/stack (esperado) |
| **Information disclosure** — métricas | `MetricsScrapeGuard` + token en tiempo constante | Público si falta token y sin restricción de red (SEC-1) |
| **Information disclosure** — logs | Política de no registrar payloads/secretos | Cumplimiento por convención, no forzado técnicamente (SEC-5) |
| **Denial of service** | Rate limiting global + límite de body; storage resiliente ante caída de Redis | Límites por defecto genéricos; ajustar por tráfico real |
| **DoS** — SSRF/recursos externos | Allowlist de hosts, timeouts, tope de bytes de respuesta | — |
| **Elevation of privilege** — BOLA/horizontal | Propiedad por recurso en servicio; acceso ajeno → 404 | Depende de verificación consistente por endpoint (auditar) |
| **EoP** — BFLA/función | `RolesGuard` + `@Roles`; scopes de staff por sucursal | Endpoints sin `@Roles` quedan solo autenticados |

## Controles transversales

- CORS por allowlist, helmet, `x-powered-by` deshabilitado, `strict` JSON.
- Validación de configuración al arranque (falla rápido ante secretos débiles o combinaciones
  prohibidas en producción, p. ej. mock de acceso o notificación MOCK).

Ver [[08-security/authentication]], [[08-security/authorization]], [[08-security/input-validation]],
[[08-security/data-protection]], [[08-security/audit-trail]].
