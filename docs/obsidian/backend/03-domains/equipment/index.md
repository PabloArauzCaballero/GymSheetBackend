---
title: "Equipment"
type: domain
status: verified
criticality: low
last_reviewed: "2026-08-06"
source_revision: "27f3fd2"
domain: "equipment"
source_files: [
  "src/modules/equipment/equipment.controller.ts",
  "src/modules/equipment/equipment.service.ts",
  "src/modules/equipment/equipment.repository.ts",
  "src/modules/equipment/equipment.schemas.ts",
  "src/modules/equipment/equipment.model.ts"
]
tags: [backend, domain]
related: ["[[03-domains/facilities/index]]", "[[03-domains/exercises/index]]"]
---

# Equipment

## Resumen

Catálogo de equipamiento del gimnasio (activos): alta/actualización/inactivación por ADMIN y listado de
disponibles para cualquier usuario autenticado. Recurso organizacional compartido (sin propiedad por
usuario).

## Responsabilidad

- Mantener el inventario de equipos (`EquipmentModel`) con estado y datos de activo.
- Proveer `EquipmentRepository` para validación de enlaces (exercises) y asignaciones (facilities).

## Límites

- No gestiona asignación a salas ni mantenimiento (eso es `facilities`).

## Entradas

HTTP `/equipment` y `/admin/equipment` (protegido), Zod.

## Salidas

DTOs vía `equipment.mapper.ts`.

## Casos de uso

Usuario: listar equipos AVAILABLE. ADMIN: crear/actualizar/inactivar.

## Reglas de negocio

- `listAvailableEquipment` mapea solo AVAILABLE.
- `findLinkableIds` considera enlazable todo lo no INACTIVE (incluye MAINTENANCE).

## Componentes principales

| Componente | Tipo | Responsabilidad | Evidencia |
|---|---|---|---|
| `EquipmentController` / `AdminEquipmentController` | Controllers | Listado y administración | `equipment.controller.ts` |
| `EquipmentService` | Service | CRUD delgado | `equipment.service.ts` |
| `EquipmentRepository` | Repository | Consultas reusadas | `equipment.repository.ts` |

## Entidades y datos

`EquipmentModel` (`equipos_gym`; status AVAILABLE por defecto; `HasMany` `EquipmentAssignmentModel` y
`MaintenanceEventModel` de facilities). Detalle: [[05-data/index]].

## Endpoints o contratos

`GET /equipment`; admin `/admin/equipment` (POST create, PATCH :id, DELETE :id). [[04-api/index]].

## Eventos

Ninguno propio; el estado del equipo lo muta `facilities` (asignación/mantenimiento) que sí emite
eventos.

## Dependencias

Consumido por `exercises` (`validateEquipmentIds`) y `facilities` (asignación/mantenimiento). El modelo
declara relaciones hacia facilities.

## Autenticación y permisos

Guards globales; mutaciones ADMIN-only. Sin propiedad por usuario. Ausente → 404.

## Manejo de errores

`NotFoundException` en update/inactivate de equipo inexistente.

## Transacciones y consistencia

N/A en el módulo (mutaciones simples).

## Observabilidad

`INFERIDO`: sin métricas específicas.

## Pruebas

Sin spec en el módulo.

## Riesgos

- `DATA-1` — Create/update pasan input directo a Sequelize sin traducir `UniqueConstraintError` a 409
  (p. ej. `serialNumber`/`assetTag` únicos) → potencial 500, violando la regla de idempotencia
  (`INFERIDO` si hay índice único).
- `GET /equipment` sin paginación → listado no acotado.
- `findLinkableIds` permite enlazar equipo en MAINTENANCE (solo excluye INACTIVE) — puede ser
  intencional.
- Sin cobertura de pruebas.

## Referencias al código

- `equipment.service.ts` → `listAvailableEquipment`, `updateEquipment`, `inactivateEquipment`.
- `equipment.repository.ts` → `findLinkableIds`.
- `equipment.schemas.ts` → `createEquipmentSchema`, `updateEquipmentSchema`.

## Relaciones

[[03-domains/facilities/index]] · [[03-domains/exercises/index]]
