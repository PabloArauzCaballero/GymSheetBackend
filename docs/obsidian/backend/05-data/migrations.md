---
type: data
status: verified
last_reviewed: 2026-08-06
source_revision: 27f3fd2
tags: [backend, data]
---

# Migraciones

10 migraciones de negocio en `src/database/migrations/`, registradas en `index.ts`. El esquema se
gestiona **solo** por migraciones (nunca `sync`, regla `.claude/rules/80-database.md`). Todas
ejecutan en transacción (`executeSqlStatements` / `executeStatements`) y traen `up` y `down`.
Referencia corta usada en [[relationship-catalog]]: `M1`..`M10`.

| Ref | ID | Objetivo | Objetos afectados | Riesgos | Rollback |
|---|---|---|---|---|---|
| M1 | 202607170001-hardening-exercise-data | Provenance externa, media multilingüe y guardas de unicidad en ejercicios/sesiones | `public.ejercicios` (+cols jsonb), `training.exercise_media` (nueva), índices únicos parciales sobre sesiones/series | Índices únicos parciales pueden fallar si hay datos que violan la nueva unicidad (p.ej. 2 sesiones activas por usuario) | `down` completo: drop índices/tabla/columnas |
| M2 | 202607190001-facilities-membership | Sucursales, salas, puntos de acceso, asignación de equipos, planes, membresías y staff | Esquemas `facilities`, `membership`; amplía CHECK de `usuarios.rol` (+COACH, +FRONT_DESK) | Recreación de CHECK de rol: filas con roles fuera del nuevo set fallarían (no aplica, es superset) | `down` recrea CHECK original y elimina tablas/esquemas |
| M3 | 202607190002-access-notifications-outbox | Credenciales, dispositivos, eventos y decisiones de acceso; notificaciones; outbox transaccional | Esquemas `access_control`, `notifications`, `integration`; tablas cola con índices de claim | Ninguno destacable (tablas nuevas) | `down` elimina tablas y esquemas |
| M4 | 202607190003-legacy-import-staging | Staging canónico e idempotente para imports legacy | `integration.legacy_import_batches`, `legacy_import_records` | — | `down` elimina ambas tablas |
| M5 | 202607190004-equipment-plan-customer-details | Ciclo de vida de activos, tipos de plan, perfiles de cliente | `public.equipos_gym` (+cols, CHECK, UK parciales), `facilities.maintenance_events`, `membership.plans` (+plan_type), `membership.customer_profiles` | UK parciales sobre asset_tag/serial exigen unicidad de datos existentes | `down` elimina columnas/constraints/tabla en orden inverso |
| M6 | 202607190005-notification-preferences | Preferencias de notificación con consentimiento | `notifications.preferences` | — | `down` elimina tabla |
| M7 | 202607190006-domain-events-and-membership-history | Historiales append-only, enlace outbox↔evento, integridad de quiet-hours | `integration.domain_events` (+trigger append-only), `outbox_jobs.domain_event_id`, `membership.status_history` (+trigger), refuerza CHECK quiet_hours | Triggers append-only bloquean UPDATE/DELETE: cambios futuros de datos históricos imposibles por diseño | `down` elimina triggers/funciones, columna y tablas; revierte CHECK quiet_hours |
| M8 | 202607220001-exercise-dataset-sync-state | Estado de refresco del dataset externo de ejercicios | `integration.exercise_dataset_sync_state` (PK varchar) | — | `down` elimina tabla |
| M9 | 202607220002-customer-experience | Onboarding persistente, historial de mediciones, comercio de membresía, media y entitlements | Esquemas `profile`, `media`; `membership.plans` (+precio/benefits/public_id), `features`, `plan_features`, `entitlements`, `intents`, `extensions`; **`ALTER perfiles_antropometricos.edad DROP NOT NULL`** | Relaja NOT NULL de `edad` (expand); `plan_features` PK compuesta | `down` elimina en orden inverso (no re-impone NOT NULL de edad — cuidado con compatibilidad) |
| M10 | 202608010001-training-plans-routines | Dominio de entrenamiento: rutinas, ejercicios prescritos, asignaciones y enlaces a sesión | Esquema `training`; `routines`, `routine_exercises`, `routine_assignments`; +FK `sesiones_entrenamiento.routine_id/routine_assignment_id` | UK parcial de asignación activa exige no duplicar asignación ACTIVE por rutina+cliente | `down` elimina columnas de sesión, tablas y esquema `training` |

## Observaciones

- **Estrategia expand/contract:** M9 relaja `edad` a NULL (expand) sin contract; su `down` **no**
  re-impone `NOT NULL`, lo que es correcto para evitar romper filas con `edad` NULL creadas después.
- **Append-only por trigger:** M7 hace `domain_events` y `status_history` inmutables a nivel de base;
  cualquier proceso que intente actualizarlas recibirá excepción de PostgreSQL. Es una decisión
  irreversible en la práctica salvo rollback de la migración.
- **`docs/db/schema.sql` no refleja M2–M10** (solo Fase 1). No usarlo como fuente para esos objetos.
- IDs de migración inmutables tras despliegue (regla 80-database).

## Referencias

- [[physical-data-model]] · [[relationship-catalog]] · ADR-0005 (outbox)
