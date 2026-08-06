---
title: "REST · Equipment"
type: api
status: verified
last_reviewed: "2026-08-06"
source_revision: "27f3fd2"
tags: [backend, api]
---

# REST · Equipment

Controlador: `src/modules/equipment/equipment.controller.ts`
(`EquipmentController` público-autenticado + `AdminEquipmentController` con
`@Roles(ADMIN)`) · Servicio: `equipment.service.ts` · Esquemas:
`equipment.schemas.ts`. En OpenAPI.

| Método | Ruta | Rol | Body | Errores | Propósito |
|---|---|---|---|---|---|
| GET | `/equipment` | JWT | — | — | Catálogo disponible |
| POST | `/admin/equipment` | ADMIN | `createEquipmentSchema` | 400, 403, 409 | Crear |
| PATCH | `/admin/equipment/:id` | ADMIN | `updateEquipmentSchema` | 400, 403, 404 | Actualizar |
| DELETE | `/admin/equipment/:id` | ADMIN | — | 403, 404 | Inhabilita sin borrar historial |

`CreateEquipmentRequest`: `nombre` 2–140, `tipo` (`EquipmentType`:
MAQUINA/MANCUERNA/BARRA/DISCO/BANCO/POLEA/BANDA/ACCESORIO/OTRO), `descripcion?` ≤500.
`estado` (`EquipmentStatus`: DISPONIBLE/MANTENIMIENTO/INACTIVO) editable en update.

Las relaciones ejercicio↔equipamiento aceptan solo IDs existentes y vinculables; se
deduplican antes de persistir.

Relacionado: [[exercises]] · [[facilities]] · [[03-domains/equipment/index]]
