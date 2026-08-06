---
title: "Referencia — Matriz de permisos"
type: reference
status: verified
last_reviewed: "2026-08-06"
source_revision: "27f3fd2"
tags: [backend, reference, permissions]
related: ["[[08-security/authorization]]"]
---

# Matriz de permisos

> Validación efectiva: guards globales `JwtAuthGuard` + `RolesGuard` (`app.module.ts`) + **propiedad por recurso** en servicios. Rol tomado de la BD (revalidación del principal), no del token. Acceso horizontal ajeno → 404.

| Recurso | Acción | Requisito | Validación | Evidencia |
|---|---|---|---|---|
| `auth/login`, `auth/register` | público | ninguno | rutas abiertas + rate limit | `auth.controller` |
| Recursos propios (workouts, profiles, membership `me`) | CRUD propio | autenticado + propietario | `JwtAuthGuard` + chequeo de propiedad → 404 si ajeno | servicios de módulo |
| Admin de membership (planes, intents) | gestión | rol **ADMIN** | `@Roles(ADMIN)` de método estrecha al de clase | `membership.controller` |
| Facilities (branches, rooms, access-points) | gestión | rol **ADMIN** | `@Roles(ADMIN)` | `facilities.controller` |
| Access-control (credenciales, dispositivos) | gestión | staff/ADMIN | guards + scope | `access-control.controller` |
| `mock-access` | crear evento mock | `ACCESS_MOCK_ENABLED` + no producción | `env.ts` prohíbe en prod | `mock-access.controller` |
| `health/metrics` | scrape | `METRICS_SCRAPE_TOKEN` | `MetricsScrapeGuard` (tiempo constante) | `metrics-scrape.guard.ts` |
| `health/live`, `health/ready` | sonda | ninguno / red | `@SkipThrottle` | `health.controller` |

> [!warning] Riesgos
> - BOLA descentralizado (SEC-05): la propiedad se valida por servicio, sin mecanismo central — auditar cada endpoint nuevo.
> - Inconsistencia 403/404 (SEC-04) en training/exercises.
> Ver [[14-audits/risks-register]].

Staff scopes: `staff-branch-scope` / `staff-profile` acotan el alcance de staff por sucursal. Ver [[03-domains/membership/index]].
