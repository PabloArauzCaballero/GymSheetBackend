# Source inventory — rev 27f3fd2

## Módulos (`src/modules/`)

access-control · auth · equipment · exercises · export · facilities · health · integration · membership · notifications · profiles · training · users · workouts (15).

## Modelos Sequelize (44)

- **access-control**: access-credential, access-decision, access-device-event, access-device
- **equipment**: equipment
- **exercises**: exercise, exercise-equipment, exercise-media, user-exercise
- **facilities**: access-point, branch, equipment-assignment, maintenance-event, room
- **integration**: domain-event, legacy-import-batch, legacy-import-record, outbox-job
- **membership**: customer-profile, entitlement, media-file, membership, membership-extension, membership-feature, membership-intent, membership-plan, membership-status-history, plan-access-scope, plan-feature, staff-branch-scope, staff-profile
- **notifications**: delivery-attempt, notification, notification-preference
- **profiles**: anthropometric-profile, body-measurement, onboarding
- **training**: routine, routine-assignment, routine-exercise
- **users**: user
- **workouts**: workout-session, workout-session-exercise, workout-set

## Migraciones de negocio (`src/database/migrations/`, 10)

202607170001-hardening-exercise-data · 202607190001-facilities-membership · 202607190002-access-notifications-outbox · 202607190003-legacy-import-staging · 202607190004-equipment-plan-customer-details · 202607190005-notification-preferences · 202607190006-domain-events-and-membership-history · 202607220001-exercise-dataset-sync-state · 202607220002-customer-experience · 202608010001-training-plans-routines.

## Workers (`src/workers/`)

access-event · exercises-dataset-refresh · membership-reminder · notification-delivery + worker-loop, worker-bootstrap.

## Contratos / esquemas

- `docs/endpoints/openapi.yaml` (46 paths) · `docs/endpoints/openapi-observability.yaml`
- `docs/db/schema.sql` (397 líneas, esquema físico)

## Documentación previa

`docs/architecture/*` · `docs/operations/*` · `docs/decisions/ADR-000{1..5}` · `BACKEND_AUDIT_HARDENING_AND_ACTION_PLAN.md`.
