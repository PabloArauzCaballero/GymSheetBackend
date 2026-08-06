---
type: data
status: verified
last_reviewed: 2026-08-06
source_revision: 27f3fd2
tags: [backend, data]
---

# Catálogo de relaciones

Todas las claves foráneas relevantes del esquema físico (migraciones). `Origen` = tabla con la FK.
Evidencia: `M#` = migración (ver [[migrations]]); `S` = `docs/db/schema.sql`.

| ID | Origen | Relación | Destino | Cardinalidad | FK / mecanismo | Integridad | ON DELETE | Evidencia |
|---|---|---|---|---|---|---|---|---|
| R01 | perfiles_antropometricos | pertenece a | usuarios | 1:1 | FK `usuario_id` UNIQUE | UK | CASCADE | S |
| R02 | ejercicios | creado por | usuarios | N:1 opc | FK `created_by_usuario_id` | CHECK global/personal | SET NULL | S |
| R03 | ejercicios_equipos | referencia | ejercicios | N:1 | FK `ejercicio_id` | UK par | CASCADE | S |
| R04 | ejercicios_equipos | referencia | equipos_gym | N:1 | FK `equipo_gym_id` | UK par | RESTRICT | S |
| R05 | usuarios_ejercicios | selecciona | usuarios | N:1 | FK `usuario_id` | UK par | CASCADE | S |
| R06 | usuarios_ejercicios | selecciona | ejercicios | N:1 | FK `ejercicio_id` | UK par | RESTRICT | S |
| R07 | sesiones_entrenamiento | de | usuarios | N:1 | FK `usuario_id` | UK par activa | CASCADE | S |
| R08 | sesiones_entrenamiento | origina | training.routines | N:1 opc | FK `routine_id` | — | SET NULL | M10 |
| R09 | sesiones_entrenamiento | ejecuta | training.routine_assignments | N:1 opc | FK `routine_assignment_id` | — | SET NULL | M10 |
| R10 | sesiones_ejercicios | de | sesiones_entrenamiento | N:1 | FK `sesion_id` | UK orden | CASCADE | S |
| R11 | sesiones_ejercicios | usa | ejercicios | N:1 | FK `ejercicio_id` | UK identidad | RESTRICT | S |
| R12 | series_entrenamiento | de | sesiones_ejercicios | N:1 | FK `sesion_ejercicio_id` | UK numero | CASCADE | S |
| R13 | training.exercise_media | de | ejercicios | N:1 | FK `ejercicio_id` | UK par | CASCADE | M1 |
| R14 | training.exercise_media | creado por | usuarios | N:1 opc | FK `created_by_usuario_id` | — | SET NULL | M1 |
| R15 | facilities.rooms | en | facilities.branches | N:1 | FK `branch_id` | UK (branch,code) | RESTRICT | M2 |
| R16 | facilities.access_points | en | facilities.branches | N:1 | FK `branch_id` | UK (branch,code) | RESTRICT | M2 |
| R17 | facilities.access_points | en | facilities.rooms | N:1 opc | FK `room_id` | — | RESTRICT | M2 |
| R18 | facilities.equipment_assignments | de | equipos_gym | N:1 | FK `equipment_id` | UK activa | RESTRICT | M2 |
| R19 | facilities.equipment_assignments | en | facilities.rooms | N:1 | FK `room_id` | — | RESTRICT | M2 |
| R20 | facilities.equipment_assignments | asignado por | usuarios | N:1 opc | FK `assigned_by_user_id` | — | SET NULL | M2 |
| R21 | facilities.maintenance_events | de | equipos_gym | N:1 | FK `equipment_id` | — | RESTRICT | M4 |
| R22 | facilities.maintenance_events | creado por | usuarios | N:1 opc | FK `created_by_user_id` | — | SET NULL | M4 |
| R23 | membership.plan_access_scopes | de | membership.plans | N:1 | FK `plan_id` | UK scope | CASCADE | M2 |
| R24 | membership.plan_access_scopes | alcanza | facilities.branches | N:1 | FK `branch_id` | UK scope | RESTRICT | M2 |
| R25 | membership.plan_access_scopes | alcanza | facilities.rooms | N:1 opc | FK `room_id` | UK scope | RESTRICT | M2 |
| R26 | membership.memberships | de | usuarios | N:1 | FK `user_id` | UK periodo | RESTRICT | M2 |
| R27 | membership.memberships | usa | membership.plans | N:1 | FK `plan_id` | UK periodo | RESTRICT | M2 |
| R28 | membership.memberships | creada por | usuarios | N:1 opc | FK `created_by_user_id` | — | SET NULL | M2 |
| R29 | membership.staff_profiles | de | usuarios | 1:1 | FK `user_id` UNIQUE | UK | RESTRICT | M2 |
| R30 | membership.staff_branch_scopes | de | membership.staff_profiles | N:1 | FK `staff_profile_id` | UK (staff,branch) | CASCADE | M2 |
| R31 | membership.staff_branch_scopes | alcanza | facilities.branches | N:1 | FK `branch_id` | UK (staff,branch) | RESTRICT | M2 |
| R32 | membership.customer_profiles | de | usuarios | 1:1 | FK `user_id` UNIQUE | UK | RESTRICT | M4 |
| R33 | membership.plans | imagen | media.files | N:1 opc | FK `image_file_id` | — | SET NULL | M9 |
| R34 | membership.plan_features | de | membership.plans | N:1 | FK `plan_id` (PK comp.) | PK comp | CASCADE | M9 |
| R35 | membership.plan_features | incluye | membership.features | N:1 | FK `feature_id` (PK comp.) | PK comp | RESTRICT | M9 |
| R36 | membership.entitlements | de | usuarios | N:1 | FK `user_id` | UK origen | CASCADE | M9 |
| R37 | membership.entitlements | otorga | membership.features | N:1 | FK `feature_id` | UK origen | RESTRICT | M9 |
| R38 | membership.intents | de | usuarios | N:1 | FK `user_id` | UK idempotencia | CASCADE | M9 |
| R39 | membership.intents | sobre | membership.memberships | N:1 opc | FK `membership_id` | — | SET NULL | M9 |
| R40 | membership.intents | usa | membership.plans | N:1 | FK `plan_id` | — | RESTRICT | M9 |
| R41 | membership.extensions | extiende | membership.memberships | N:1 | FK `membership_id` | — | RESTRICT | M9 |
| R42 | membership.extensions | proviene de | membership.intents | 1:1 | FK `intent_id` UNIQUE | UK | RESTRICT | M9 |
| R43 | membership.extensions | creada por | usuarios | N:1 | FK `created_by_user_id` | — | RESTRICT | M9 |
| R44 | membership.status_history | de | membership.memberships | N:1 | FK `membership_id` | append-only | RESTRICT | M6 |
| R45 | membership.status_history | actor | usuarios | N:1 opc | FK `actor_user_id` | — | RESTRICT | M6 |
| R46 | membership.status_history | respalda | integration.domain_events | 1:1 | FK `domain_event_id` UNIQUE | UK | RESTRICT | M6 |
| R47 | access_control.credentials | de | usuarios | N:1 | FK `user_id` | UK parciales | RESTRICT | M3 |
| R48 | access_control.devices | en | facilities.access_points | N:1 | FK `access_point_id` | UK externo | RESTRICT | M3 |
| R49 | access_control.device_events | de | access_control.devices | N:1 | FK `device_id` | UK source | RESTRICT | M3 |
| R50 | access_control.device_events | usa | access_control.credentials | N:1 | FK `credential_id` | — | RESTRICT | M3 |
| R51 | access_control.decisions | resuelve | access_control.device_events | 1:1 | FK `device_event_id` UNIQUE | UK | RESTRICT | M3 |
| R52 | access_control.decisions | de | usuarios | N:1 | FK `user_id` | — | RESTRICT | M3 |
| R53 | access_control.decisions | justificada por | membership.memberships | N:1 opc | FK `membership_id` | — | SET NULL | M3 |
| R54 | access_control.decisions | justificada por | membership.staff_profiles | N:1 opc | FK `staff_profile_id` | — | SET NULL | M3 |
| R55 | notifications.messages | para | usuarios | N:1 | FK `recipient_user_id` | UK dedup | RESTRICT | M3 |
| R56 | notifications.messages | sobre | membership.memberships | N:1 opc | FK `membership_id` | — | SET NULL | M3 |
| R57 | notifications.delivery_attempts | de | notifications.messages | N:1 | FK `notification_id` | UK intento | CASCADE | M3 |
| R58 | notifications.preferences | de | usuarios | 1:1 | FK `user_id` UNIQUE | UK | CASCADE | M5 |
| R59 | integration.outbox_jobs | emite | integration.domain_events | N:1 opc | FK `domain_event_id` | — | RESTRICT | M6 |
| R60 | integration.domain_events | actor | usuarios | N:1 opc | FK `actor_user_id` | append-only | RESTRICT | M6 |
| R61 | integration.domain_events | causado por | integration.domain_events | N:1 opc | FK `causation_event_id` (self) | append-only | RESTRICT | M6 |
| R62 | integration.legacy_import_batches | solicitado por | usuarios | N:1 opc | FK `requested_by_user_id` | UK identidad | SET NULL | M4 |
| R63 | integration.legacy_import_records | de | integration.legacy_import_batches | N:1 | FK `batch_id` | UK identidad | CASCADE | M4 |
| R64 | profile.onboarding | de | usuarios | 1:1 | FK `user_id` (PK) | PK=FK | CASCADE | M9 |
| R65 | profile.body_measurements | de | usuarios | N:1 | FK `user_id` | UK idempotencia | CASCADE | M9 |
| R66 | profile.body_measurements | creada por | usuarios | N:1 | FK `created_by_user_id` | — | RESTRICT | M9 |
| R67 | training.routines | creada por | usuarios | N:1 | FK `created_by_user_id` | índice | CASCADE | M10 |
| R68 | training.routine_exercises | de | training.routines | N:1 | FK `routine_id` | UK orden | CASCADE | M10 |
| R69 | training.routine_exercises | prescribe | ejercicios | N:1 | FK `ejercicio_id` | — | RESTRICT | M10 |
| R70 | training.routine_assignments | de | training.routines | N:1 | FK `routine_id` | UK activa | CASCADE | M10 |
| R71 | training.routine_assignments | para | usuarios (cliente) | N:1 | FK `cliente_user_id` | UK activa | CASCADE | M10 |
| R72 | training.routine_assignments | asignada por | usuarios (coach) | N:1 | FK `asignado_por_user_id` | índice | CASCADE | M10 |

## Observaciones de integridad

- **Anti-huérfano de negocio (RESTRICT):** `usuarios` referenciado por `memberships`, `credentials`,
  `notifications`, `decisions`, `staff_profiles`, `customer_profiles` con **RESTRICT** — un usuario con
  historial no se borra en cascada; primero se limpian dependencias (protege trazabilidad).
- **Cascadas de composición (CASCADE):** jerarquías propias del agregado (sesión→ejercicios→series;
  rutina→ejercicios/asignaciones; batch→records; plan→features/scopes) sí cascada.
- **Referencias blandas (SET NULL):** autoría/creador opcional (`created_by_*`, `assigned_by_*`) y
  membresía que justifica una decisión/notificación.
- **Auto-referencia:** `domain_events.causation_event_id` modela la cadena causal de eventos.

## Referencias

- [[physical-data-model]] · [[indexing-and-query-patterns]] · [[migrations]]
