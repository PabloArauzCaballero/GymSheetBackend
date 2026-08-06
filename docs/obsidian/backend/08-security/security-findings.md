---
title: "Hallazgos de seguridad"
type: security
status: verified
criticality: high
last_reviewed: "2026-08-06"
source_revision: "27f3fd2"
source_files:
  - "src/modules/health/metrics-scrape.guard.ts"
  - "src/config/env.ts"
  - "src/common/filters/http-exception.filter.ts"
  - "BACKEND_AUDIT_HARDENING_AND_ACTION_PLAN.md"
tags: [backend, security, findings]
---

# Hallazgos de seguridad

> Defensivo. Cada hallazgo incluye evidencia, impacto y recomendación. Los códigos **SEC-x** son de
> esta documentación; los **F-0xx** provienen de `BACKEND_AUDIT_HARDENING_AND_ACTION_PLAN.md`.

## Hallazgos de esta revisión documental

| ID | Hallazgo | Evidencia | Impacto | Recomendación |
|---|---|---|---|---|
| **SEC-1** | `/health/metrics` es público en routing; protección opt-in | `health.controller.ts:9,35-37`, `metrics-scrape.guard.ts:19` (sin token → `return true`) | Exposición de topología, tráfico y ventanas de error si falta token y sin restricción de red | Definir `METRICS_SCRAPE_TOKEN` **y** restringir por red en producción |
| **SEC-2** | Refresh/rotación de tokens no implementada | `env.ts:117-118` (secreto configurado) sin endpoint de refresh en el código revisado | Sin renovación segura ni revocación de sesión más allá de la revalidación del principal | Implementar refresh rotativo con revocación, o documentar que se usa solo access token corto |
| **SEC-3** | CORS con `credentials: true` + allowlist | `main.ts:40-47`, `CORS_ORIGINS` (`env.ts:47`) | Si la allowlist incluyera comodines, se filtrarían credenciales cross-origin | Garantizar que `CORS_ORIGINS` nunca use `*`; validar en despliegue |
| **SEC-4** | Enumeración de cuentas por registro | `auth.service.ts:42-43` (409 "ya existe") | Un atacante confirma si un email está registrado vía `/auth/register` | Mensaje/uniformidad de respuesta; considerar verificación por correo |
| **SEC-5** | No-registro de PII/secretos es convención, no forzado | `observability-and-alerts.md` §Log policy; ausencia de redactor central | Riesgo de fuga de PII si un log incluye un objeto sin sanear | Redactor central de logs / lista de campos prohibidos |
| **SEC-6** | Propiedad por recurso depende de cada servicio | `workouts.service.ts:260,275,288` (patrón correcto) pero no centralizado | Riesgo de BOLA en endpoints que omitan la verificación | Auditar cada endpoint; considerar guard/util de propiedad reutilizable |

> INFERIDO: SEC-2, SEC-5 y SEC-6 se deducen de la ausencia de mecanismo en el código revisado; no son
> vulnerabilidades confirmadas por explotación. Requieren verificación endpoint por endpoint.

## Hallazgos de la auditoría de producción (referencia F-0xx)

Fuente: `BACKEND_AUDIT_HARDENING_AND_ACTION_PLAN.md`. Se citan porque fueron **invisibles a los gates
estáticos** y solo aparecieron al ejecutar y romper el sistema a propósito (aprendizaje de la regla
crítica de `CLAUDE.md`).

| ID | Hallazgo | Categoría | Estado |
|---|---|---|---|
| **F-012** | Regresión de la ruta de compilación (build no arrancable) introducida por las suites e2e; faltaba un campo recién añadido | Despliegue | Verificado (corregido con `tsconfig.build.json`) |
| **F-014** | Una caída de Redis derribaba toda la API y provocaba bucle de reinicios | Seguridad/Disponibilidad | Verificado (corregido con `ResilientThrottlerStorage`) |
| **F-015** | Los workers descartaban silenciosamente **todos** sus logs (faltaba `flushLogs()`) | Observabilidad | Verificado (corregido en `worker-bootstrap.ts`) |
| **F-016** | Los workers heredaban una sonda HTTP imposible de satisfacer (marcados *unhealthy*) | Despliegue/Observabilidad | Verificado (corregido con `healthcheck: disable`) |

Impacto transversal: F-015 dejaba el trabajo asíncrono (acceso físico, recordatorios, notificaciones)
**completamente inobservable** en producción; hoy los workers emiten arranque y
`worker.shutdown_requested` (ver [[09-observability/logging]] y [[09-observability/health-checks]]).

Relacionado: [[08-security/security-overview]] · [[08-security/threat-model]] · [[08-security/abuse-cases]].
