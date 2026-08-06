---
title: "Seguridad — Visión general"
type: security
status: verified
criticality: high
last_reviewed: "2026-08-06"
source_revision: "27f3fd2"
source_files:
  - "src/main.ts"
  - "src/app.module.ts"
  - "src/common/guards/jwt-auth.guard.ts"
  - "src/common/guards/roles.guard.ts"
  - "src/common/filters/http-exception.filter.ts"
  - "src/config/env.ts"
tags: [backend, security, overview]
---

# Seguridad — Visión general

> Documentación **defensiva**: describe controles y brechas, nunca cómo explotarlos.
> **No se declara el sistema "seguro".** Se enumeran controles verificados y brechas abiertas.

Backend NestJS 11 de gestión de gimnasio. Controles centralizados como guards, filtros e
interceptores globales; validación de entrada con Zod por esquema. Ver el modelo de amenazas en
[[08-security/threat-model]] y los hallazgos en [[08-security/security-findings]].

## Controles encontrados (VERIFICADO)

| Control | Mecanismo | Evidencia |
|---|---|---|
| Autenticación | JWT HS256, revalidación del principal contra DB en cada request | `jwt.strategy.ts:26`, `auth.service.ts` · [[08-security/authentication]] |
| Autorización | `JwtAuthGuard` + `RolesGuard` globales; propiedad por recurso; acceso ajeno → 404 | `app.module.ts:96-98` · [[08-security/authorization]] |
| Validación de entrada | Zod (`*.schemas.ts`) vía `ZodValidationPipe`; descarta campos no declarados | [[08-security/input-validation]] |
| Anti-enumeración | El login gasta un `bcrypt.compare` aun sin cuenta | `auth.service.ts:77-83` |
| Rate limiting | `ThrottlerGuard` global; storage resiliente Redis→memoria; `/auth/*` con límite reducido | `app.module.ts:96`, `resilient-throttler.storage.ts` |
| Cabeceras HTTP | `helmet`, `x-powered-by` deshabilitado, CORS por allowlist | `main.ts:23,35-47` |
| Límite de cuerpo | `REQUEST_BODY_LIMIT` (1mb por defecto), `strict: true` | `main.ts:31-33` |
| Redacción de errores 5xx | En producción los 5xx no exponen detalles técnicos | `http-exception.filter.ts:135-160` · [[08-security/data-protection]] |
| Secretos por entorno | Validados con Zod; longitudes mínimas; solo `.env.example` versionado | `env.ts:115-118` · [[08-security/secrets-management]] |
| SSRF salientes | Allowlist de hosts para gateway y datasets; HTTPS obligatorio | `env.ts:326-350` |
| Métricas protegibles | `MetricsScrapeGuard` con `METRICS_SCRAPE_TOKEN` en tiempo constante | `metrics-scrape.guard.ts` |
| Rastro de auditoría | `domain_events`, `membership_status_history`, `access_control.decisions` | [[08-security/audit-trail]] |

## Fronteras de confianza

- **Ingress HTTP** → API (JWT + guards + Zod). Único punto de entrada de usuarios.
- **API → PostgreSQL** (parametrizado por Sequelize; statement timeout).
- **API/Workers → gateways externos** (WhatsApp, dataset de ejercicios): allowlist SSRF + HTTPS.
- **Workers** procesan el outbox transaccional; no exponen HTTP. Ver [[09-observability/health-checks]].

## Brechas y advertencias (no exhaustivo)

- `/health/metrics` es **público en la capa de routing**; su protección depende de
  `METRICS_SCRAPE_TOKEN` o de restricción de red. Si ambos faltan, expone topología y tráfico. Ver
  [[08-security/security-findings]] (SEC-1).
- No hay **refresh token rotativo implementado**: existe `JWT_REFRESH_SECRET`/`JWT_REFRESH_EXPIRES_IN`
  en configuración pero no se observa endpoint de refresh ni revocación de tokens en el código
  revisado (SEC-2, INFERIDO).
- **CORS `credentials: true`** combinado con allowlist: correcto solo si `CORS_ORIGINS` nunca incluye
  comodines (SEC-3).
- Cuatro defectos graves (F-012/F-014/F-015/F-016) fueron **invisibles a los gates** y solo
  aparecieron en ejecución real; ver `BACKEND_AUDIT_HARDENING_AND_ACTION_PLAN.md` y
  [[08-security/security-findings]].

## Referencias

- Reglas: `.claude/rules/30-security.md`.
- Estado de producción: `BACKEND_AUDIT_HARDENING_AND_ACTION_PLAN.md`.
- Contrato de API: [[04-api/authentication]] · Dominio: [[03-domains/auth/index]].
- Operaciones: [[10-operations/observability-and-alerts]].
