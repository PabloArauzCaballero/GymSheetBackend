---
title: "Casos de abuso"
type: security
status: verified
criticality: high
last_reviewed: "2026-08-06"
source_revision: "27f3fd2"
source_files:
  - "src/modules/auth/auth.service.ts"
  - "src/common/guards/roles.guard.ts"
  - "src/common/redis/resilient-throttler.storage.ts"
  - "src/config/env.ts"
tags: [backend, security, abuse-cases]
---

# Casos de abuso

> Defensivo. Enumera **qué** se defiende y **con qué**, sin describir procedimientos de explotación.
> Complementa [[08-security/threat-model]].

| Caso de abuso | Control existente | Estado / brecha |
|---|---|---|
| Enumeración de cuentas por login | Login gasta `bcrypt.compare` aun sin cuenta; error genérico | Mitigado en login (`auth.service.ts:77-83`) |
| Enumeración de cuentas por registro | `register` responde 409 "ya existe" | Brecha residual (SEC-4): el registro revela existencia |
| Fuerza bruta de credenciales | Rate limit `AUTH_RATE_LIMIT_MAX` (10) en `/auth/*` + bcrypt costoso | Mitigado; límites ajustables |
| Reutilización de token de usuario desactivado | Revalidación del principal en DB por request | Mitigado (`jwt.strategy.ts`) |
| Acceso horizontal a recursos ajenos (BOLA) | Propiedad por recurso en servicio → 404 | Depende de consistencia por endpoint (SEC-6) |
| Escalada de función (BFLA) | `RolesGuard` + `@Roles`; scopes de staff | Endpoints sin `@Roles` quedan solo autenticados |
| Mass assignment (inyectar `role`, `id`) | Zod descarta campos no declarados | Mitigado donde se aplica el schema |
| Inyección SQL | Sequelize parametrizado; `UuidParamPipe` | Revisar `sequelize.query` crudas |
| Payloads gigantes (DoS memoria) | Límite de body 1mb, `strict` | Mitigado |
| Abuso de dependencia externa / SSRF | Allowlist de hosts, HTTPS, timeout, tope de bytes | Mitigado (gateway, datasets) |
| Caída de Redis como DoS total de la API | `ResilientThrottlerStorage` degrada a contadores por proceso, no falla abierto | Mitigado (F-014); readiness marca degradación |
| Scrape no autorizado de métricas | `MetricsScrapeGuard` + token en tiempo constante | Brecha si falta token y sin restricción de red (SEC-1) |
| Exposición de errores internos | Redacción de 5xx en producción | Mitigado |
| Filtrado de PII/secretos en logs | Política de no registrar payloads/secretos | Por convención, no forzado (SEC-5) |
| Inyección de cabeceras vía `x-request-id` | Middleware valida patrón `[A-Za-z0-9._-]{8,128}` o genera UUID | Mitigado (`request-id.middleware.ts`) |

## Notas

- Los "estados/brechas" con código SEC-x se detallan en [[08-security/security-findings]].
- Los controles de degradación controlada (Redis, workers) provienen de la auditoría de producción;
  ver `BACKEND_AUDIT_HARDENING_AND_ACTION_PLAN.md`.

Relacionado: [[08-security/threat-model]] · [[08-security/authorization]] · [[08-security/authentication]].
