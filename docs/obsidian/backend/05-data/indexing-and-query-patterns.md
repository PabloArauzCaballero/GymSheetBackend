---
type: data
status: verified
last_reviewed: 2026-08-06
source_revision: 27f3fd2
tags: [backend, data]
---

# Índices y patrones de consulta

Índices declarados en migraciones (fuente de verdad) y `schema.sql` (solo Fase 1). Se clasifican por
propósito: unicidad, claim de colas, y consulta/listado.

## Índices únicos parciales (invariantes de negocio)

| Índice | Tabla | Condición | Propósito |
|---|---|---|---|
| `uq_active_workout_per_user` | sesiones_entrenamiento | WHERE estado='EN_PROGRESO' | 1 sesión activa por usuario |
| `uq_assignment_active` | training.routine_assignments | WHERE estado='ACTIVE' | 1 asignación activa por rutina+cliente |
| `uq_active_equipment_assignment` | facilities.equipment_assignments | WHERE ended_at IS NULL | 1 asignación de equipo activa |
| `uq_active_pin_credential` | access_control.credentials | WHERE type='PIN' AND status='ACTIVE' | 1 PIN activo por usuario |
| `uq_external_biometric_credential` | access_control.credentials | WHERE external_reference NOT NULL AND status<>'REVOKED' | Biometría externa única |
| `uq_membership_external_reference` | membership.memberships | WHERE external_reference NOT NULL | Referencia externa única |
| `uq_ejercicios_source_external_id` | ejercicios | WHERE external_id NOT NULL | Idempotencia de import |
| `uq_exercise_media_primary_active` | training.exercise_media | WHERE is_primary AND status='ACTIVE' | 1 media primaria por ejercicio |
| `uq_customer_external_reference` | membership.customer_profiles | WHERE external_reference NOT NULL | Referencia externa única |

## Índices de claim de colas (workers)

| Índice | Tabla | Columnas | Uso |
|---|---|---|---|
| `ix_outbox_claim` | integration.outbox_jobs | (queue_name, status, available_at, created_at) | Claim FIFO con visibilidad/backoff |
| `ix_device_events_claim` | access_control.device_events | (queue_status, available_at, received_at) | Claim de eventos de acceso |
| `ix_outbox_domain_event` | integration.outbox_jobs | (domain_event_id) WHERE NOT NULL | Trazar job↔evento |

## Índices de listado/consulta

| Índice | Tabla | Columnas | Patrón |
|---|---|---|---|
| `idx_usuarios_email` / UK email | usuarios | (email) | Login/lookup |
| `idx_sesiones_usuario_fecha` | sesiones_entrenamiento | (usuario_id, fecha_inicio DESC) | Historial paginado del usuario |
| `idx_sesiones_estado` | sesiones_entrenamiento | (estado) | Filtro por estado |
| `ix_memberships_user_status_dates` | membership.memberships | (user_id, status, starts_on, ends_on) | Membresía vigente del usuario |
| `ix_memberships_expiration_scan` | membership.memberships | (status, ends_on) WHERE status='ACTIVE' | Escaneo de expiración (recordatorios) |
| `ix_entitlements_user_active` | membership.entitlements | (user_id, status, ends_at) | Derechos activos |
| `ix_credentials_user_status` | access_control.credentials | (user_id, status, credential_type) | Credenciales del usuario |
| `ix_access_decisions_user_date` | access_control.decisions | (user_id, decided_at DESC) | Auditoría de acceso |
| `ix_notifications_recipient_status` | notifications.messages | (recipient_user_id, status, created_at DESC) | Bandeja del usuario |
| `ix_domain_events_aggregate` / `ix_domain_events_name_time` | integration.domain_events | (aggregate...) / (event_name, occurred_at) | Reconstrucción/auditoría |
| `ix_body_measurements_user_date` | profile.body_measurements | (user_id, measured_on DESC, created_at DESC) | Historial de peso |
| `ix_routines_created_by` / `ix_routine_exercises_routine` / `ix_assignments_client` | training.* | ver migración M10 | Listados de entrenamiento |
| `ix_maintenance_equipment_status_date` | facilities.maintenance_events | (equipment_id, status, scheduled_for DESC) | Mantenimientos |
| `ix_legacy_records_batch_status` | integration.legacy_import_records | (batch_id, status, source_entity) | Progreso de import |

## Paginación

- Listados grandes se pierden en memoria: la regla `.claude/rules/50-performance.md` exige paginación
  e indexación. Los índices de listado incluyen la columna de orden (`... DESC`) para keyset/orden
  eficiente (p.ej. sesiones por `fecha_inicio DESC`, notificaciones por `created_at DESC`).

## FK sin índice dedicado (riesgo potencial de rendimiento)

PostgreSQL **no** crea índice automáticamente sobre columnas FK. Se detectan FKs cuyo lado hijo
carece de un índice que las cubra por prefijo (relevante para JOINs y para `ON DELETE`/`RESTRICT`):

| FK | Tabla | Cobertura | Observación |
|---|---|---|---|
| `equipment_id` | facilities.maintenance_events | Cubierta por `ix_maintenance_equipment_status_date` (prefijo) | OK |
| `notification_id` | notifications.delivery_attempts | UK `(notification_id, attempt_number)` cubre prefijo | OK |
| `credential_id` | access_control.device_events | **Sin índice dedicado** (el UK es `(device_id, source_event_id)`) | DATA: JOIN/borrado por credencial hace scan — INFERIDO |
| `feature_id` | membership.plan_features | PK `(plan_id, feature_id)` **no** cubre `feature_id` como prefijo | DATA: lookup "planes por feature" sin índice — INFERIDO |
| `feature_id` | membership.entitlements | `ix_entitlements_user_active` empieza por user_id; UK empieza por user_id | DATA: "entitlements por feature" sin índice — INFERIDO |
| `plan_id` | membership.intents | Sin índice dedicado | DATA: menor impacto (volumen bajo) — INFERIDO |
| `image_file_id` | membership.plans | Sin índice | Impacto bajo |
| `causation_event_id` | integration.domain_events | Sin índice | Recorrido de cadena causal poco frecuente |

> Marcados **INFERIDO**: el impacto real depende de cardinalidad y de si esos accesos ocurren en
> caliente. Verificar con `EXPLAIN`/medición antes de añadir índices (regla 50-performance: medir
> antes de optimizar).

## Referencias

- [[physical-data-model]] · [[transactions]] · [[relationship-catalog]]
