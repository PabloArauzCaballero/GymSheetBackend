---
title: "Facilities"
type: domain
status: verified
criticality: medium
last_reviewed: "2026-08-06"
source_revision: "27f3fd2"
domain: "facilities"
source_files: [
  "src/modules/facilities/facilities.controller.ts",
  "src/modules/facilities/facilities.service.ts",
  "src/modules/facilities/facilities.repository.ts",
  "src/modules/facilities/facilities.schemas.ts"
]
tags: [backend, domain]
related: ["[[03-domains/equipment/index]]", "[[03-domains/access-control/index]]", "[[03-domains/integration/index]]"]
---

# Facilities

## Resumen

Estructura física del gimnasio: sucursales, salas, puntos de acceso, asignación de equipos a salas y
ciclo de vida de eventos de mantenimiento. Provee los puntos de acceso que consume `access-control`.

## Responsabilidad

- CRUD de sucursales, salas y puntos de acceso.
- Asignar equipos a salas (finalizando la asignación previa).
- Máquina de estados de mantenimiento (schedule → start → complete) con efecto en el estado del equipo.

## Límites

- No decide accesos; solo define `AccessPointModel` (dirección/sucursal/sala).
- No define el inventario de equipos (consume `equipment`).

## Entradas

HTTP `/admin/facilities/*` (protegido), Zod.

## Salidas

DTOs vía `facilities.mapper.ts`; domain events de equipo/mantenimiento.

## Casos de uso

ADMIN/FRONT_DESK: administrar estructura y mantenimiento; ADMIN: escrituras estructurales.

## Reglas de negocio

- Parent inactivo (sucursal/sala) → 422.
- `assignEquipment`: valida equipo+sala activos, finaliza asignación previa, conflicto misma sala → 409.
- Mantenimiento: SCHEDULED→IN_PROGRESS→COMPLETED (transición inválida → 409);
  `start` pone equipo en MAINTENANCE; `complete` lo vuelve AVAILABLE y calcula `nextServiceOn` vía
  `serviceIntervalDays`.

## Componentes principales

| Componente | Tipo | Responsabilidad | Evidencia |
|---|---|---|---|
| `FacilitiesController` | Controller | Rutas `/admin/facilities/*` | `facilities.controller.ts` |
| `FacilitiesService` | Service | CRUD + asignación + mantenimiento | `facilities.service.ts` |
| `FacilitiesRepository` | Repository | Persistencia + locks | `facilities.repository.ts` |

## Entidades y datos

Esquema `facilities`: `BranchModel` (branches; code único), `RoomModel` (rooms), `AccessPointModel`
(access_points; allowedDirection), `EquipmentAssignmentModel` (equipment_assignments; `endedAt` null =
activa), `MaintenanceEventModel` (maintenance_events; cost/currency). Detalle: [[05-data/index]].

## Endpoints o contratos

`/admin/facilities/branches` (list/create/update), `/rooms` (list/create/update),
`/access-points` (list/create), `POST /equipment-assignments`,
`/maintenance` (list/create) + `PATCH /maintenance/:id/{start,complete}`. Clase `@Roles(ADMIN,
FRONT_DESK)`; escrituras estructurales `@Roles(ADMIN)`. [[04-api/index]].

## Eventos

Vía `DomainEventPublisher.record(input, transaction)`: `EQUIPMENT_ASSIGNED`, `MAINTENANCE_SCHEDULED`,
`MAINTENANCE_STARTED`, `MAINTENANCE_COMPLETED`. `ARCH-1`: usa `record` (no `recordAndEnqueue`) → los
eventos se persisten pero no se encolan al outbox. Ver [[03-domains/integration/index]].

## Dependencias

`EquipmentRepository`, `DomainEventPublisher`/`GymDomainEvent` (integration), `Sequelize`. Modelos
referencian `EquipmentModel` y `UserModel`.

## Autenticación y permisos

Guards globales; lecturas permiten FRONT_DESK; escrituras estructurales ADMIN-only; mantenimiento
permite FRONT_DESK. Sin propiedad por usuario. Ausente → 404; dependencia inactiva → 422; máquina de
estados/duplicado → 409.

## Manejo de errores

404 (branch/room/maintenance/equipment ausente), 422 (parent inactivo/incoherente), 409 (asignación
duplicada, transición inválida). Locks `LOCK.UPDATE` en `findActiveAssignment` y `findMaintenance`.

## Transacciones y consistencia

`assignEquipment` y las transiciones de mantenimiento corren en transacción con locks para evitar
doble transición concurrente.

## Procesamiento asíncrono

Ninguno.

## Observabilidad

`INFERIDO`: sin métricas específicas; los eventos alimentan `integration`.

## Pruebas

`facilities.tenant-scope.spec.ts` — alcance por gimnasio: filtro propio en sedes, por JOIN con la
sede en salas y accesos, y por JOIN con el equipo en mantenimiento; más el rechazo de escritura
sobre equipo ajeno.

## Riesgos

- `ARCH-1` — Eventos con `record` (no encolados).
- `DATA-1` — Create de branch/room/access-point sin traducir unicidad (branch.code único) a 409 →
  potencial 500.
- `completeMaintenance` pone el equipo AVAILABLE aunque exista otro mantenimiento abierto.
- FRONT_DESK puede programar/iniciar/completar mantenimiento (muta estado de equipo) pero no crear
  salas — verificar que la separación de permisos es intencional.
- Sin cobertura de pruebas de la máquina de estados.

## Referencias al código

- `facilities.service.ts` → `assignEquipment`, `startMaintenance`, `completeMaintenance`.
- `facilities.repository.ts` → `findActiveAssignment`, `findMaintenance` (locks).
- `facilities.schemas.ts` → `assignEquipmentSchema`, `scheduleMaintenanceSchema`,
  `completeMaintenanceSchema`.

## Relaciones

[[03-domains/equipment/index]] · [[03-domains/access-control/index]] · [[03-domains/integration/index]]
