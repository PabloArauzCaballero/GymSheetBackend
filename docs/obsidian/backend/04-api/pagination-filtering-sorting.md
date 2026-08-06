---
title: "Paginación, filtros y orden"
type: api
status: verified
last_reviewed: "2026-08-06"
source_revision: "27f3fd2"
tags: [backend, api]
---

# Paginación, filtros y orden

Evidencia: `docs/endpoints/openapi.yaml` (parámetros `PageParam`,
`PageSize25Param`, `PageSize20Param`), `docs/endpoints/endpoints.md`, y los
`*.schemas.ts` de exercises, workouts, membership, facilities, access-control,
notifications.

## Paginación (obligatoria en listados)

Los listados se paginan; no hay paginación en memoria (regla de rendimiento).
Parámetros de query estándar:

| Parámetro | Tipo | Regla |
|---|---|---|
| `page` | integer | mínimo 1; por defecto 1 |
| `pageSize` | integer | 1–100; **cap duro 100** |

Valor por defecto de `pageSize` según recurso:

- `GET /exercises`: **25** (`PageSize25Param`).
- `GET /workouts`: **20** (`PageSize20Param`).
- Listados admin de membership/facilities/access-control: validados por sus
  esquemas Zod de paginación (mismo cap 100). *(default exacto: INFERIDO por
  esquema, no siempre expuesto en OpenAPI.)*

Forma de la respuesta paginada (envelope `data`):

```json
{ "items": [], "page": 1, "pageSize": 25, "total": 0, "totalPages": 0 }
```

## Filtros

Confirmados en OpenAPI para `GET /exercises`:

| Parámetro | Tipo | Restricción |
|---|---|---|
| `search` | string | 1–120 |
| `grupoMuscular` | string | ≤ 100 |
| `equipoId` | UUID | equipamiento asociado |
| `bodyPart` | string | ≤ 100 |
| `targetMuscle` | string | ≤ 120 |
| `dataSource` | enum | `CUSTOM` \| `EXERCISES_DATASET` |

Otros filtros observados en controladores (no en OpenAPI, **INFERIDO** del código):

- `GET /admin/facilities/rooms` y `/access-points`: `branchId` (query).
- `GET /admin/access/history`, `/access/me`: filtro de historial
  (`accessHistoryFilterSchema`).
- `GET /admin/facilities/maintenance`: `maintenanceFilterSchema`.
- `GET /notifications/me`: `notificationListSchema`.

## Orden

> **INFERIDO.** No hay parámetro `sort`/`order` expuesto en OpenAPI ni en los
> controladores revisados. El orden se decide en cada servicio/repositorio (p. ej.
> "mediciones ordenadas por fecha", "historial por fecha"). No existe ordenación
> configurable por el cliente en la revisión `27f3fd2`.

Relacionado: [[conventions]] · [[index]]
