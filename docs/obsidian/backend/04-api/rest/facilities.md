---
title: "REST · Facilities"
type: api
status: verified
last_reviewed: "2026-08-06"
source_revision: "27f3fd2"
tags: [backend, api]
---

# REST · Facilities

Controlador: `src/modules/facilities/facilities.controller.ts`
(`@Controller('admin/facilities')`, clase `@Roles(ADMIN, FRONT_DESK)`) · Servicio:
`facilities.service.ts` · Esquemas: `facilities.schemas.ts`. **No en OpenAPI.**

Sucursales, salas, puntos de acceso, asignación de equipamiento y mantenimiento.

| Método | Ruta | Rol | Body/query | Propósito |
|---|---|---|---|---|
| GET | `/admin/facilities/branches` | ADMIN, FRONT_DESK | `paginationSchema` | Sucursales paginadas |
| POST | `/admin/facilities/branches` | ADMIN | `createBranchSchema` | Crear sucursal |
| PATCH | `/admin/facilities/branches/:id` | ADMIN | `updateBranchSchema` | Actualizar sucursal |
| GET | `/admin/facilities/rooms` | ADMIN, FRONT_DESK | `branchId?`, `paginationSchema` | Salas (filtro por sucursal) |
| POST | `/admin/facilities/rooms` | ADMIN | `createRoomSchema` | Crear sala |
| PATCH | `/admin/facilities/rooms/:id` | ADMIN | `updateRoomSchema` | Actualizar sala |
| GET | `/admin/facilities/access-points` | ADMIN, FRONT_DESK | `branchId?` | Puntos de acceso |
| POST | `/admin/facilities/access-points` | ADMIN | `createAccessPointSchema` | Crear punto de acceso |
| POST | `/admin/facilities/equipment-assignments` | ADMIN | `assignEquipmentSchema` | Asigna equipamiento a sala |
| GET | `/admin/facilities/maintenance` | ADMIN, FRONT_DESK | `maintenanceFilterSchema` | Mantenimientos filtrables |
| POST | `/admin/facilities/maintenance` | ADMIN, FRONT_DESK | `scheduleMaintenanceSchema` | Programa mantenimiento |
| PATCH | `/admin/facilities/maintenance/:id/start` | ADMIN, FRONT_DESK | — | Inicia |
| PATCH | `/admin/facilities/maintenance/:id/complete` | ADMIN, FRONT_DESK | `completeMaintenanceSchema` | Completa |

Notas:

- El guard de método estrecha a **solo ADMIN** las mutaciones de topología
  (branches, rooms, access-points, equipment-assignments); mantenimiento lo pueden
  operar ADMIN y FRONT_DESK.
- El actor (`actor.id`) se registra en asignaciones y mantenimiento.
- Enums: `RoomType`/`RoomStatus`, `FacilityStatus`, `AccessDirection`,
  `MaintenanceType`/`MaintenanceStatus`.

Relacionado: [[equipment]] · [[access-control]] · [[04-api/authorization]] · [[03-domains/facilities/index]]
