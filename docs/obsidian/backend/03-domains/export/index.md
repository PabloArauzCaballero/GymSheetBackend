---
title: "Export"
type: domain
status: verified
criticality: low
last_reviewed: "2026-08-06"
source_revision: "27f3fd2"
domain: "export"
source_files: [
  "src/modules/export/export.controller.ts",
  "src/modules/export/export.service.ts"
]
tags: [backend, domain]
related: ["[[03-domains/workouts/index]]", "[[03-domains/profiles/index]]"]
---

# Export

## Resumen

Exportación síncrona y acotada del historial de entrenamiento del usuario, en JSON y CSV, con defensa
anti-inyección de fórmulas CSV y un tope duro de sesiones.

## Responsabilidad

- Componer el historial de entrenamiento del usuario (usuario + perfil + sesiones + equipos).
- Serializar a JSON o CSV seguro.

## Límites

- No posee datos: consume servicios de otros módulos.
- No ofrece trabajo asíncrono real: supera el tope → rechaza (413), no encola.

## Entradas

HTTP `GET /export/workout-history[/csv]` (protegido), contexto de auth.

## Salidas

Payload JSON en español (`generadoEn`) o CSV (`text/csv`, adjunto).

## Casos de uso

Usuario: descargar su historial de entrenamiento.

## Reglas de negocio

- `MAX_EXPORTED_SESSIONS = 1000`; `EXPORT_PAGE_SIZE = 100`. Si se alcanza el tope antes de la última
  página → `PayloadTooLargeException` (413), dirigiendo a un job asíncrono.
- `escapeCsvCell`: dobla comillas y neutraliza fórmulas (`= + - @` → prefijo `'`).

## Componentes principales

| Componente | Tipo | Responsabilidad | Evidencia |
|---|---|---|---|
| `ExportController` | Controller | `/export/workout-history[/csv]` | `export.controller.ts` |
| `ExportService` | Service | Componer y serializar (JSON/CSV) | `export.service.ts` |

## Entidades y datos

Sin modelos propios; consume `WorkoutSessionResponse` y otros DTOs. Detalle: [[05-data/index]].

## Endpoints o contratos

`GET /export/workout-history` (JSON), `GET /export/workout-history/csv` (CSV). [[04-api/index]].

## Eventos

Ninguno. El límite síncrono se señala solo con 413; no se encola job (la ruta asíncrona es aspiracional,
`INFERIDO` no implementada en este módulo).

## Dependencias

`UsersModule`, `ProfilesModule`, `WorkoutsModule`, `EquipmentModule`
(`getActiveUserOrFail`, `getMyProfile`, `listMySessions`, `listAvailableEquipment`).

## Autenticación y permisos

Autenticado (guard global); estrictamente scopeado por `currentUser.id`, sin parámetro cross-user.

## Manejo de errores

413 al exceder el tope síncrono; defensa anti-inyección CSV; `getActiveUserOrFail` lanza si el usuario
está inactivo/ausente.

## Transacciones y consistencia

N/A (solo lecturas paginadas).

## Procesamiento asíncrono

Sin worker. La frontera síncrono/asíncrono es el tope de 1000 sesiones; más allá se rechaza en vez de
delegar. Ver [[07-async-processing/workers]].

## Observabilidad

`INFERIDO`: sin métricas específicas.

## Pruebas

`export.service.spec.ts` — neutralización de fórmulas (`= + - @`), comillas + fórmula combinadas,
comillas embebidas, nombre normal intacto, header + una fila por set, header-only vacío; lecturas
acotadas (detiene en última página; rechaza export que excede el límite → 413).

## Riesgos

- La "ruta asíncrona" es un rechazo duro, no un fallback: usuarios con >1000 sesiones no pueden
  exportar (`export.service.ts`). Sin outbox/job pese a la guía ADR para trabajo asíncrono.
- El export JSON construye todo el payload en memoria (sin streaming como el CSV): 1000 sesiones × sets
  puede ser grande (`INFERIDO`).
- `listAvailableEquipment()` es global (no scopeado por usuario) — incluido en cada export; aceptable si
  es catálogo público (`INFERIDO`).

## Referencias al código

- `export.service.ts` → `buildWorkoutHistoryExport`, `buildWorkoutHistoryCsv`,
  `listSessionsForExport`, `escapeCsvCell`.

## Relaciones

[[03-domains/workouts/index]] · [[03-domains/profiles/index]] · [[03-domains/users/index]] ·
[[03-domains/equipment/index]]
