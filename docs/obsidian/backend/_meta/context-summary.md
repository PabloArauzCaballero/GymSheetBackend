# Context Summary — GymSheet Backend

> Resumen compacto para agentes. Consultar **antes** de releer archivos extensos.

## Stack (VERIFICADO)

- **NestJS 11** · TypeScript 5.7 (strict) · **Sequelize 6** · **PostgreSQL 16** · **Zod 3** · JWT HS256 (access+refresh) · **Redis** (rate limiting compartido, opcional) · Docker · GitHub Actions.
- Gestor de paquetes: **yarn**. Build: `nest build` → `dist/main.js`.

## Topología de ejecución

- **API** HTTP (`src/main.ts`, `AppModule`).
- **Workers** independientes (`src/workers/`): access-event, exercises-dataset-refresh, membership-reminder, notification-delivery. Loop de polling (`worker-loop.ts`, `worker-bootstrap.ts`).
- **Mensajería**: patrón **transactional outbox** (`src/modules/integration/`, ADR-0005) — `outbox-job`, `domain-event`.
- **Gateway** opcional (`src/gateway/`, `GATEWAY_ENABLED`).

## Módulos (15) `src/modules/`

`access-control` · `auth` · `equipment` · `exercises` · `export` · `facilities` · `health` · `integration` · `membership` · `notifications` · `profiles` · `training` · `users` · `workouts`.

## Dominios núcleo

- **Membership** (el más grande, 18 modelos): planes, features, intents de renovación/extensión, entitlements, staff/scopes, historial de estado.
- **Access-control**: credenciales, dispositivos, decisiones, eventos (biometría/acceso físico; adapter boundary ADR-0002).
- **Training/Workouts**: rutinas, ejercicios de rutina, asignaciones, sesiones y sets de entrenamiento.
- **Exercises**: catálogo + media, sync de dataset externo (SSRF allowlist).
- **Notifications**: preferencias, entrega vía gateway externo (WhatsApp), recordatorios de membresía.

## Persistencia

- 44 models Sequelize · 10 migraciones de negocio (`src/database/migrations/`) · esquema físico consolidado en `docs/db/schema.sql` (397 líneas, fuente de verdad física).

## API

- 113 rutas HTTP en 19 controllers · **46 paths** en `docs/endpoints/openapi.yaml` (contrato existente).
- Auth JWT HS256, revalidación del principal en cada request. Acceso horizontal ajeno → **404** (no 403).

## Documentación previa relevante (reutilizar, no duplicar)

- `docs/architecture/` (architecture.md, flows.md, event-driven-production-audit.md)
- `docs/db/schema.sql`, `docs/endpoints/openapi.yaml`
- `docs/decisions/ADR-0001..0005`
- `docs/operations/` (backup-restore-and-rollback, docker-and-messaging, observability-and-alerts)
- `BACKEND_AUDIT_HARDENING_AND_ACTION_PLAN.md` (auditoría, hallazgos F-012/F-014/F-015/F-016)

## Convenciones

- Validación externa con Zod (`*.schemas.ts`), descarta campos no declarados (anti mass-assignment).
- Autorización en backend + propiedad por recurso. Errores 5xx redactados en prod.
- Nunca devolver modelos ORM directos → usar mappers.
- Secretos solo por env; solo `.env.example` versionado.

## Revisión

- source_revision: `27f3fd2` · rama `fix/membership-seed-and-lock` · last_reviewed 2026-08-06.
