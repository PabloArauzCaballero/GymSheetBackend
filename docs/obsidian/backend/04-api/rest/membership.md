---
title: "REST · Membership"
type: api
status: verified
last_reviewed: "2026-08-06"
source_revision: "27f3fd2"
tags: [backend, api]
---

# REST · Membership

Controlador: `src/modules/membership/membership.controller.ts` (3 clases:
`MembershipController`, `MembershipStoreController`, `AdminMembershipController`) ·
Servicio: `membership.service.ts` · Esquemas: `membership.schemas.ts`.

Es el dominio más grande (planes, precios, intents de renovación/extensión,
entitlements, staff/scopes, historial de estado).

## Autoservicio y tienda (JWT)

| Método | Ruta | Auth | Body | Errores | Propósito |
|---|---|---|---|---|---|
| GET | `/memberships/me` | Owner | — | 401 | Mi membresía (NO en OpenAPI) |
| GET | `/membership/plans` | JWT | — | — | Planes de tienda |
| GET | `/membership/plans/:id` | JWT | — | 404 | Plan comercial |
| GET | `/me/membership` | Owner | — | — | Proyección de membresía |
| GET | `/me/accesses` | Owner | — | — | Derechos efectivos (no inferidos del rol) |
| GET | `/me/membership/options` | Owner | — | — | Opciones compatibles según estado |
| POST | `/me/membership/renewal-intent` | Owner | `membershipIntentSchema` | 201 | Intención idempotente; **no concede acceso** |
| POST | `/me/membership/extension-intent` | Owner | `membershipIntentSchema` | 201 | Intención idempotente; **no extiende aún** |

## Administración — `AdminMembershipController` (`@Roles(ADMIN, FRONT_DESK)` en clase)

| Método | Ruta | Rol | Body | Propósito |
|---|---|---|---|---|
| GET | `/admin/membership/plans` | ADMIN, FRONT_DESK | — | Listar planes |
| POST | `/admin/membership/plans` | ADMIN | `createPlanSchema` | Crear plan |
| PATCH | `/admin/membership/plans/:id` | ADMIN | `updatePlanSchema` | Actualizar plan |
| PATCH | `/admin/membership/plans/:id/scopes` | ADMIN | `replacePlanScopesSchema` | Reemplaza scopes de acceso |
| POST | `/admin/membership/customers` | ADMIN, FRONT_DESK | `createCustomerSchema` | Alta de cliente |
| GET | `/admin/membership/customers` | ADMIN, FRONT_DESK | `membershipListSchema` (query) | Listar (paginado) |
| POST | `/admin/membership/memberships` | ADMIN, FRONT_DESK | `createMembershipSchema` | Crear membresía |
| GET | `/admin/membership/memberships` | ADMIN, FRONT_DESK | `membershipListSchema` (query) | Listar (paginado) |
| PATCH | `/admin/membership/memberships/:id/status` | ADMIN, FRONT_DESK | `membershipStatusSchema` | Cambiar estado |
| POST | `/admin/membership/staff` | ADMIN | `createStaffSchema` | Alta de staff |
| PATCH | `/admin/membership/staff/:userId/status` | ADMIN | `updateStaffStatusSchema` | Estado de staff |
| POST | `/admin/membership/intents/:id/confirm` | ADMIN | — | Confirma intención y aplica tiempo **transaccionalmente** (única vez) |

Solo `intents/:id/confirm`, la tienda y el autoservicio están en OpenAPI; el resto
de administración **no**. Validación Zod en cada mutación; el actor (`actor.id`)
se registra para auditoría.

Relacionado: [[04-api/authorization]] · [[03-domains/membership/index]]
