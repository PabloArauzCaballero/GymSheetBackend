---
title: "Autorización"
type: api
status: verified
last_reviewed: "2026-08-06"
source_revision: "27f3fd2"
tags: [backend, api]
---

# Autorización

Evidencia: `src/app.module.ts` (guards globales), `src/common/guards/roles.guard.ts`,
`src/common/decorators/roles.decorator.ts`, `src/common/enums/domain.enums.ts`,
y verificación de propiedad en los servicios de cada módulo.

## Capas de control

La autorización se aplica **en el backend**, nunca en el cliente. Tres capas:

1. **`JwtAuthGuard` (global)** — exige JWT válido y usuario activo salvo `@Public()`.
2. **`RolesGuard` (global)** — si el handler/controlador declara `@Roles(...)`,
   exige que el `role` (revalidado desde BD) esté en la lista; si no, `403`
   ("No tienes permisos para realizar esta acción"). Sin `@Roles`, pasa.
3. **Propiedad por recurso (en el servicio)** — para recursos de usuario, el
   servicio filtra por `user.id`. El acceso a un recurso ajeno responde **404, no
   403**, para no revelar su existencia.

Orden de registro en `app.module.ts`: `ThrottlerGuard` → `JwtAuthGuard` →
`RolesGuard`.

## Roles (`UserRole`)

| Enum interno | Valor en API/BD |
|---|---|
| ADMIN | `ADMIN` |
| CLIENT | `CLIENTE` |
| EXTERNAL_TRAINER | `ENTRENADOR_EXTERNO` |
| COACH | `COACH` |
| FRONT_DESK | `FRONT_DESK` |

## Uso de `@Roles` observado

- **ADMIN**: `admin/equipment/*`, `admin/exercises/global/*`,
  `admin/exercises/import/*`, `admin/access/devices` (create/update),
  `admin/access/mock/*`, y las mutaciones sensibles de membresía (crear/actualizar
  planes y scopes, staff, `intents/:id/confirm`).
- **ADMIN + FRONT_DESK** (a nivel de controlador): `admin/membership/*`,
  `admin/access` (histórico/eventos), `admin/access/credentials/*`,
  `admin/facilities/*`. Dentro, ciertas mutaciones estrechan a solo **ADMIN** con
  un `@Roles(ADMIN)` a nivel de método (p. ej. crear sucursal/sala/punto de acceso,
  crear plan/staff).
- **COACH + ADMIN**: `GET /routines/assignments/coach`, `POST /routines/:id/assign`.

> `@Roles` a nivel de método **sobrescribe** al de clase (`getAllAndOverride`): en
> `admin/facilities` la clase pide ADMIN+FRONT_DESK pero `POST branches` exige solo
> ADMIN.

## Propiedad por recurso (acceso horizontal → 404)

Los servicios reciben `user.id` (vía `@CurrentUser()`) y acotan la consulta a los
recursos del principal. Ejemplos: workouts (`getMySession`, sets/ejercicios de
sesión), ejercicios personales, media propia, perfil/onboarding, notificaciones,
historial de acceso, credenciales propias, exportaciones. Un identificador válido
que pertenezca a otro usuario devuelve **404**, no `403` — regla explícita del
proyecto ([[08-security/authorization]]).

Detalle de "visible": en `exercises`, un `GET /exercises/:id` ve globales activos
y personales propios; lo no visible es `404`. En media, mutar multimedia de un
ejercicio global requiere ADMIN; la de un personal, su dueño.

## Endpoints administrativos y métricas

- Rutas `admin/*`: autenticadas y con `@Roles`.
- `GET /health/metrics`: `MetricsScrapeGuard` — si `METRICS_SCRAPE_TOKEN` está
  fijado exige `Authorization: Bearer <token>` (comparación en tiempo constante);
  si no, queda abierto y se espera restricción a nivel de red. Ver [[rate-limits]]
  y [[error-model]].

Relacionado: [[authentication]] · [[08-security/authorization]] · [[error-model]]
