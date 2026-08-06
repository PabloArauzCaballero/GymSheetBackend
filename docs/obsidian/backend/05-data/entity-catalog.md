---
type: data
status: verified
last_reviewed: 2026-08-06
source_revision: 27f3fd2
tags: [backend, data]
---

# Catálogo de entidades

Las 44 entidades persistentes (modelos Sequelize `*.model.ts`) con su tabla física y esquema.
Tipo: **Agregado raíz** / **Entidad** / **Detalle** (parte de un agregado) / **Historial** (append-only) /
**Cola** / **Unión** (N:M) / **Referencia** (catálogo). Almacén: todos PostgreSQL (esquema entre
paréntesis). Sensibilidad: ver [[sensitive-data]].

| ID | Entidad | Dominio | Tipo | Almacén (tabla) | Sensib. | Owner |
|---|---|---|---|---|---|---|
| E01 | user | identidad | Agregado raíz | pg (public.usuarios) | PII+cred | users/auth |
| E02 | anthropometric-profile | perfiles | Detalle (1:1 user) | pg (public.perfiles_antropometricos) | PII salud | profiles |
| E03 | onboarding | perfiles | Entidad (1:1 user) | pg (profile.onboarding) | PII salud | profiles |
| E04 | body-measurement | perfiles | Historial | pg (profile.body_measurements) | PII salud | profiles |
| E05 | equipment | equipamiento | Entidad | pg (public.equipos_gym) | Baja | equipment |
| E06 | exercise | ejercicios | Agregado raíz | pg (public.ejercicios) | Baja | exercises |
| E07 | exercise-equipment | ejercicios | Unión (N:M) | pg (public.ejercicios_equipos) | Baja | exercises |
| E08 | user-exercise | ejercicios | Unión (N:M) | pg (public.usuarios_ejercicios) | Baja | exercises |
| E09 | exercise-media | ejercicios | Detalle | pg (training.exercise_media) | Baja | exercises |
| E10 | workout-session | workouts | Agregado raíz | pg (public.sesiones_entrenamiento) | Media | workouts |
| E11 | workout-session-exercise | workouts | Detalle | pg (public.sesiones_ejercicios) | Baja | workouts |
| E12 | workout-set | workouts | Detalle | pg (public.series_entrenamiento) | Baja | workouts |
| E13 | branch | instalaciones | Agregado raíz | pg (facilities.branches) | Baja | facilities |
| E14 | room | instalaciones | Entidad | pg (facilities.rooms) | Baja | facilities |
| E15 | access-point | instalaciones | Entidad | pg (facilities.access_points) | Baja | facilities |
| E16 | equipment-assignment | instalaciones | Entidad | pg (facilities.equipment_assignments) | Baja | facilities |
| E17 | maintenance-event | instalaciones | Entidad | pg (facilities.maintenance_events) | Financiero | facilities |
| E18 | membership-plan | membership | Referencia/Agregado | pg (membership.plans) | Financiero | membership |
| E19 | plan-access-scope | membership | Detalle | pg (membership.plan_access_scopes) | Baja | membership |
| E20 | membership | membership | Agregado raíz | pg (membership.memberships) | Baja | membership |
| E21 | staff-profile | membership | Entidad (1:1 user) | pg (membership.staff_profiles) | PII | membership |
| E22 | staff-branch-scope | membership | Unión (N:M) | pg (membership.staff_branch_scopes) | Baja | membership |
| E23 | customer-profile | membership | Entidad (1:1 user) | pg (membership.customer_profiles) | PII | membership |
| E24 | membership-status-history | membership | Historial (append-only) | pg (membership.status_history) | Baja | membership |
| E25 | membership-feature | membership | Referencia | pg (membership.features) | Baja | membership |
| E26 | plan-feature | membership | Unión (N:M, PK comp.) | pg (membership.plan_features) | Baja | membership |
| E27 | entitlement | membership | Entidad | pg (membership.entitlements) | Baja | membership |
| E28 | membership-intent | membership | Entidad | pg (membership.intents) | Financiero | membership |
| E29 | membership-extension | membership | Entidad (1:1 intent) | pg (membership.extensions) | Baja | membership |
| E30 | media-file | membership/media | Referencia | pg (media.files) | Baja | membership |
| E31 | access-credential | access-control | Agregado raíz | pg (access_control.credentials) | Biométrico+cred | access-control |
| E32 | access-device | access-control | Entidad | pg (access_control.devices) | Baja | access-control |
| E33 | access-device-event | access-control | Cola | pg (access_control.device_events) | Baja | access-control |
| E34 | access-decision | access-control | Historial/Entidad | pg (access_control.decisions) | Baja | access-control |
| E35 | notification | notifications | Agregado raíz | pg (notifications.messages) | Media (PII) | notifications |
| E36 | delivery-attempt | notifications | Detalle | pg (notifications.delivery_attempts) | Baja | notifications |
| E37 | notification-preference | notifications | Entidad (1:1 user) | pg (notifications.preferences) | Media | notifications |
| E38 | outbox-job | integration | Cola | pg (integration.outbox_jobs) | Media (payload) | integration |
| E39 | domain-event | integration | Historial (append-only) | pg (integration.domain_events) | Media (payload) | integration |
| E40 | legacy-import-batch | integration | Entidad | pg (integration.legacy_import_batches) | Baja | integration |
| E41 | legacy-import-record | integration | Detalle (staging) | pg (integration.legacy_import_records) | Media | integration |
| E42 | routine | training | Agregado raíz | pg (training.routines) | Baja | training |
| E43 | routine-exercise | training | Detalle | pg (training.routine_exercises) | Baja | training |
| E44 | routine-assignment | training | Entidad | pg (training.routine_assignments) | Baja | training |

## Nota

- Tabla física adicional **sin modelo Sequelize decorado**: `integration.exercise_dataset_sync_state`
  (PK `source_key`), gestionada por el worker de refresco de dataset (INFERIDO: acceso por
  repositorio/raw). No cuenta entre los 44 modelos.
- Fichas detalladas de las 6 entidades críticas en `entities/`: [[entities/user]], [[entities/membership]],
  [[entities/entitlement]], [[entities/access-credential]], [[entities/outbox-job]], [[entities/notification]].

## Referencias

- [[data-dictionary]] · [[relationship-catalog]] · [[physical-data-model]]
