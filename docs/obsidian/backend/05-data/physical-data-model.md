---
type: data
status: verified
last_reviewed: 2026-08-06
source_revision: 27f3fd2
tags: [backend, data]
---

# Modelo físico de datos

Tablas reales de PostgreSQL con PK/FK/UK/CHECK, índices, defaults y enums lógicos (varchar + CHECK,
**no** tipos ENUM nativos). Fuente: migraciones versionadas en `src/database/migrations/`.

> [!warning] `docs/db/schema.sql` está incompleto
> `schema.sql` (397 líneas) solo describe las **9 tablas de la Fase 1** en `public` (usuarios,
> perfiles antropométricos, equipos, ejercicios, sesiones y series) y declara explícitamente que la
> "Fase 2" (rutinas, membresías, notificaciones, eventos) **no está implementada** en ese archivo.
> Sin embargo, esa Fase 2 **sí existe** en migraciones. Por tanto, para todo lo que no sea `public`
> Fase 1, la **fuente de verdad son las migraciones**, no `schema.sql`. Ver [[migrations]] y las
> contradicciones al final.

## Esquemas (namespaces)

`public` · `facilities` · `membership` · `access_control` · `notifications` · `integration` ·
`training` · `profile` · `media`.

## public (núcleo Fase 1)

### usuarios
PK `id` uuid. UK `email`. Defaults: `rol='CLIENTE'`, `estado='ACTIVO'`, timestamps `now()`.
CHECK `ck_usuarios_rol` (ADMIN, CLIENTE, ENTRENADOR_EXTERNO, **COACH, FRONT_DESK** — ampliado por
migración `202607190001`), `ck_usuarios_estado` (ACTIVO, INACTIVO). Índice `idx_usuarios_email`.

### perfiles_antropometricos
PK `id`. FK `usuario_id → usuarios(id)` ON DELETE CASCADE, **UNIQUE** (1:1). CHECK peso>0,
estatura 80–250, objetivo en 6 valores. `edad` pasó a **NULLABLE** (migración `202607220002`).

### equipos_gym
PK `id`. CHECK tipo (9 valores), estado (DISPONIBLE, MANTENIMIENTO, INACTIVO). Ampliado con
`asset_tag`, `serial_number`, `manufacturer`, garantía/servicio y `metadata` jsonb. UK parciales
`uq_equipment_asset_tag`, `uq_equipment_serial_number` (WHERE NOT NULL).

### ejercicios
PK `id`. FK `created_by_usuario_id → usuarios(id)` ON DELETE SET NULL. CHECK tipo (GLOBAL/PERSONAL),
estado, y `ck_ejercicio_global_o_personal` (GLOBAL ⇒ creador NULL; PERSONAL ⇒ creador NOT NULL).
Provenance externo (`data_source`, `external_id`, jsonb `secondary_muscles/instructions/metadata`).
UK parcial `uq_ejercicios_source_external_id (data_source, external_id) WHERE external_id NOT NULL`.
Índices de visibilidad y filtros de entrenamiento.

### ejercicios_equipos
PK `id`. FK `ejercicio_id` CASCADE, `equipo_gym_id` RESTRICT. UK `(ejercicio_id, equipo_gym_id)`.

### usuarios_ejercicios
PK `id`. FK `usuario_id` CASCADE, `ejercicio_id` RESTRICT. UK `(usuario_id, ejercicio_id)`.

### sesiones_entrenamiento
PK `id`. FK `usuario_id` CASCADE; añadidas FK `routine_id`/`routine_assignment_id → training.*`
ON DELETE SET NULL. CHECK estado (EN_PROGRESO, FINALIZADA, CANCELADA) y fechas. **UK parcial
`uq_active_workout_per_user (usuario_id) WHERE estado='EN_PROGRESO'`** (una sesión activa por usuario).

### sesiones_ejercicios
PK `id`. FK `sesion_id` CASCADE, `ejercicio_id` RESTRICT. UK `(sesion_id, orden)` y
`(sesion_id, ejercicio_id)`. CHECK orden>0.

### series_entrenamiento
PK `id`. FK `sesion_ejercicio_id` CASCADE. UK `(sesion_ejercicio_id, numero_serie)`. CHECK reps>0,
peso 0–1000, rir 0–10, descanso≥0.

## facilities

| Tabla | PK | FK | UK / CHECK relevantes |
|---|---|---|---|
| `branches` | id | — | UK `code`; CHECK status(ACTIVE,INACTIVE) |
| `rooms` | id | `branch_id`→branches RESTRICT | UK `(branch_id,code)`; CHECK room_type(8), status(4), capacity>0 |
| `access_points` | id | `branch_id` RESTRICT, `room_id` RESTRICT | UK `(branch_id,code)`; CHECK direction(ENTRY,EXIT,BOTH) |
| `equipment_assignments` | id | `equipment_id`→equipos_gym RESTRICT, `room_id` RESTRICT, `assigned_by_user_id` SET NULL | UK parcial `uq_active_equipment_assignment(equipment_id) WHERE ended_at IS NULL`; CHECK fechas |
| `maintenance_events` | id | `equipment_id` RESTRICT, `created_by_user_id` SET NULL | CHECK type(3), status(4), fechas, costo(moneda `^[A-Z]{3}$`) |

## membership

| Tabla | PK | FK | UK / CHECK relevantes |
|---|---|---|---|
| `plans` | id | `image_file_id`→media.files SET NULL | UK `code`, `public_id`; CHECK duration 1–3650, status, plan_type(7), price/currency, benefits array |
| `plan_access_scopes` | id | `plan_id` CASCADE, `branch_id` RESTRICT, `room_id` RESTRICT | UK `(plan_id,branch_id,room_id)` **NULLS NOT DISTINCT** |
| `memberships` | id | `user_id` RESTRICT, `plan_id` RESTRICT, `created_by_user_id` SET NULL | UK `(user_id,plan_id,starts_on,ends_on)`; UK parcial `external_reference`; CHECK ends≥starts, status(4) |
| `staff_profiles` | id | `user_id` RESTRICT **UNIQUE** | CHECK position(3), employment_status(3), fechas |
| `staff_branch_scopes` | id | `staff_profile_id` CASCADE, `branch_id` RESTRICT | UK `(staff_profile_id,branch_id)` |
| `customer_profiles` | id | `user_id` RESTRICT **UNIQUE** | UK `customer_number`; UK parcial `external_reference`; índice parcial teléfono |
| `status_history` | id | `membership_id` RESTRICT, `actor_user_id` RESTRICT, `domain_event_id` RESTRICT **UNIQUE** | CHECK from/to status, transición ≠. **Append-only por trigger** |
| `features` | id | — | UK `code`; CHECK status |
| `plan_features` | **(plan_id, feature_id)** | `plan_id` CASCADE, `feature_id` RESTRICT | PK compuesta |
| `entitlements` | id | `user_id` CASCADE, `feature_id` RESTRICT | UK `(user_id,feature_id,source_type,source_id)`; CHECK source(5), status(3), fechas |
| `intents` | id | `user_id` CASCADE, `membership_id` SET NULL, `plan_id` RESTRICT | UK `public_id`, `(user_id,idempotency_key)`; CHECK type(2), months 1–24, status(4), channel(2) |
| `extensions` | id | `membership_id` RESTRICT, `intent_id` RESTRICT **UNIQUE**, `created_by_user_id` RESTRICT | CHECK new_ends>previous, added_days>0 |

## access_control

| Tabla | PK | FK | UK / CHECK relevantes |
|---|---|---|---|
| `credentials` | id | `user_id`→usuarios RESTRICT | UK parcial PIN activo por usuario; UK parcial biométrica externa; CHECK type(3), status(3), **material** (PIN⇒pin_hash; FACE/FINGERPRINT⇒external_ref + consent) |
| `devices` | id | `access_point_id` RESTRICT | UK `(adapter_key,external_device_id)`; CHECK status(4) |
| `device_events` | id | `device_id` RESTRICT, `credential_id` RESTRICT | UK `(device_id,source_event_id)`; CHECK direction, queue_status(5), attempts≥0. **Tabla-cola** (claim index) |
| `decisions` | id | `device_event_id` RESTRICT **UNIQUE**, `user_id` RESTRICT, `membership_id` SET NULL, `staff_profile_id` SET NULL | CHECK outcome(GRANTED,DENIED), days_remaining≥0 |

## notifications

| Tabla | PK | FK | UK / CHECK relevantes |
|---|---|---|---|
| `messages` | id | `recipient_user_id` RESTRICT, `membership_id` SET NULL | UK `deduplication_key`; CHECK channel(3), status(5), days≥0 |
| `delivery_attempts` | id | `notification_id` CASCADE | UK `(notification_id,attempt_number)`; CHECK number>0, status(SENT,FAILED) |
| `preferences` | id | `user_id` CASCADE **UNIQUE** | CHECK preferred_channel(2), consentimiento externo condicional, quiet_hours coherentes |

## integration

| Tabla | PK | FK | UK / CHECK relevantes |
|---|---|---|---|
| `outbox_jobs` | id | `domain_event_id`→domain_events RESTRICT | UK `deduplication_key`; CHECK status(5), attempts, `payload` es object. **Tabla-cola** |
| `domain_events` | id | `actor_user_id` RESTRICT, `causation_event_id`→self RESTRICT | UK `deduplication_key`; CHECK version>0, payload/metadata object. **Append-only por trigger** |
| `legacy_import_batches` | id | `requested_by_user_id` SET NULL | UK `(source_system,external_batch_id)`; CHECK status(6), counts≥0 |
| `legacy_import_records` | id | `batch_id` CASCADE | UK `(batch_id,source_entity,source_record_id)`; CHECK status(5), fingerprint hex64 |
| `exercise_dataset_sync_state` | **`source_key`** (varchar) | — | CHECK sha256 hex64, record_count 1–5000. Sin modelo Sequelize decorado (INFERIDO: acceso por repositorio/raw) |

## training

| Tabla | PK | FK | UK / CHECK relevantes |
|---|---|---|---|
| `routines` | id | `created_by_user_id` CASCADE | CHECK visibilidad(3), estado(2), objetivo(6). Índice parcial TEMPLATE |
| `routine_exercises` | id | `routine_id` CASCADE, `ejercicio_id` RESTRICT | UK `(routine_id,orden)`; CHECK orden 1–500, series 1–100, reps/peso/rir/descanso |
| `routine_assignments` | id | `routine_id` CASCADE, `cliente_user_id` CASCADE, `asignado_por_user_id` CASCADE | UK parcial `uq_assignment_active(routine_id,cliente_user_id) WHERE estado='ACTIVE'`; CHECK estado(3) |
| `exercise_media` | id | `ejercicio_id` CASCADE, `created_by_usuario_id` SET NULL | UK parciales identidad externa y primario activo; CHECK https, checksum, dimensiones |

## profile / media

| Tabla | PK | FK | UK / CHECK relevantes |
|---|---|---|---|
| `profile.onboarding` | **`user_id`** | `user_id`→usuarios CASCADE | CHECK status(4), step 1–5, goal(7), units, arrays jsonb |
| `profile.body_measurements` | id | `user_id` CASCADE, `created_by_user_id` RESTRICT | UK `(user_id,idempotency_key)` NULLS NOT DISTINCT; CHECK weight 0–1000, unit, source(4) |
| `media.files` | id | — | UK `public_id`, `code`; CHECK file_type(4), source_type(2), status, dimensiones |

## Enums lógicos (varchar + CHECK)

El esquema **no usa tipos ENUM nativos de PostgreSQL**; todos los "enums" son `varchar` con CHECK
(cabecera de `schema.sql`: "SIN ENUMS"). El catálogo de valores está en
`src/common/enums/domain.enums.ts` (35 enums). Ver detalle por entidad en [[data-dictionary]].

## Contradicciones esquema vs. modelo

1. **`schema.sql` es parcial (Fase 1).** No incluye 35 de las 44 tablas. → Preferir migraciones.
2. **ENUM nativo en modelos vs. varchar+CHECK físico.** `UserModel.role/status` y
   `AnthropometricProfileModel.goal` declaran `DataType.ENUM(...)`, pero el esquema físico usa
   `varchar` + CHECK. Como el esquema se gestiona **solo por migraciones** (nunca `sync`), la
   declaración ENUM del modelo **no llega a la base**; es cosmética/engañosa. → Preferir físico
   (varchar+CHECK).
3. **`edad` NOT NULL en `schema.sql` vs. NULLABLE real.** Migración `202607220002` ejecutó
   `ALTER COLUMN edad DROP NOT NULL`; el modelo ya refleja `allowNull: true`. → `schema.sql`
   desactualizado.

## Referencias

- [[relationship-catalog]] · [[indexing-and-query-patterns]] · [[migrations]] · [[data-dictionary]]
