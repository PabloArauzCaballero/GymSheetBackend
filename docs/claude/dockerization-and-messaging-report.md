# Dockerización integral y mensajería — informe

Fecha: 2026-08-02  
Rama: `fix/membership-seed-and-lock`

## Resumen ejecutivo

El backend **ya contaba** con una arquitectura de contenedores y de mensajería asíncrona de nivel
producción. La auditoría inicial mostró que la mayoría del pliego (multietapa, usuario no
privilegiado, healthchecks, orden de arranque, secretos por entorno, reintentos/backoff/DLQ,
idempotencia, cierre controlado, escalado horizontal) **ya estaba implementado**.

En consecuencia el trabajo se enfocó en (a) formalizar la decisión de mensajería con un ADR en lugar
de introducir un broker externo que habría roto la atomicidad transaccional y violado
`.claude/rules/10-backend-architecture.md`, y (b) cerrar las brechas reales: observabilidad de cola,
entorno de desarrollo separado y afinado de recursos. No se rompió ninguna funcionalidad existente.

## Auditoría inicial (estado previo)

- **Dockerfile** multietapa (`builder`/`dependencies`/`runtime`), `node:22-alpine`, usuario `node`,
  `read_only`, `tini`, healthcheck de liveness, guardias de artefacto (`test -f dist/...`).
- **docker-compose.yml**: postgres 16, redis 7 (efímero, solo rate limit), migrate one-shot, api y
  **4 workers**, con gates de salud, límites de memoria, `restart`, `stop_grace_period`, secretos
  fail-fast.
- **Mensajería**: outbox transaccional (`integration.outbox_jobs`) con `FOR UPDATE SKIP LOCKED`,
  lease por worker, backoff exponencial (`min(3600, 2^intento·5)` s), `DEAD_LETTER`, deduplicación
  única, concurrencia/prefetch acotados y cierre por `AbortSignal`.

## Decisión crítica: mensajería

Requisito y reglas entraban en conflicto (introducir broker vs. no romper arquitectura / no colas
externas sin ADR). Resolución: **consolidar el outbox sobre PostgreSQL** y documentarlo en
[ADR-0005](../decisions/ADR-0005-messaging-transactional-outbox.md). Un broker externo seguiría
necesitando un outbox para evitar la doble escritura, añadiría un componente a operar y está
sobredimensionado para el volumen real (eventos por minuto, latencia en segundos). Se definieron
disparadores medibles de reevaluación (backlog sostenido, latencia sub-segundo, fan-out/streaming).

## Cambios realizados

### Código (observabilidad de cola)

| Archivo | Cambio |
|---|---|
| `src/modules/integration/outbox.repository.ts` | `aggregateQueueMetrics()`: conteo por `queue_name`/`status` (solo estados accionables) + antigüedad de backlog, con el índice `ix_outbox_claim`. |
| `src/modules/integration/outbox-metrics.service.ts` | Renderiza `gym_sheet_outbox_jobs` y `gym_sheet_outbox_backlog_age_seconds` en formato Prometheus. |
| `src/modules/integration/outbox-metrics.service.spec.ts` | 4 casos: render, vacío, clamp por clock-skew, escape de labels. |
| `src/modules/integration/integration.module.ts` | Registra/exporta `OutboxMetricsService`. |
| `src/modules/health/health.module.ts` | Importa `IntegrationModule`. |
| `src/modules/health/health.controller.ts` | `getMetrics` async: concatena métricas HTTP + cola. |
| `src/modules/integration/outbox.repository.ts` | `countCompletedBefore` / `deleteCompletedBefore` (lote, `SKIP LOCKED`, solo COMPLETED). |
| `src/modules/integration/outbox-retention.service.ts` | Retención opt-in; dry-run vs `apply`; solo COMPLETED. |
| `src/modules/integration/outbox-retention.service.spec.ts` | 4 casos: dry-run, cutoff, lotes, drenaje. |
| `src/workers/outbox-prune.command.ts` + `outbox-maintenance.module.ts` | Comando one-shot `db:outbox:prune` (`--apply` para borrar). |

### Infraestructura

| Archivo | Cambio |
|---|---|
| `Dockerfile` | Nuevo stage `development` (hot-reload) **antes** de `runtime`; el target por defecto sigue siendo producción. |
| `docker-compose.dev.yml` | Override de desarrollo: build `development`, bind-mount de `./src`, `nest --watch` (API) y `node --watch` (workers), Postgres publicado, Redis opcional. |
| `package.json` | Scripts `worker:*:dev` (hot-reload de workers) y `db:outbox:prune[:prod]`. |
| `src/config/env.ts` + `.env.example` | `OUTBOX_RETENTION_DAYS` (30), `OUTBOX_PRUNE_BATCH_SIZE` (1000). |
| `docker-compose.yml` | Límites de CPU + `reservations` de memoria/CPU en postgres, redis, api y los 4 workers. |
| `docs/operations/docker-and-messaging.md` | Diagrama de servicios (mermaid), colas, comandos, escalado, health checks, diagnóstico y pruebas de resiliencia. |
| `docs/operations/observability-and-alerts.md` | Métricas de cola y alertas (backlog, dead-letter, worker stalled). |

## Evidencia ejecutada

| Verificación | Comando | Resultado |
|---|---|---|
| Type-check | `yarn type-check` | ✅ `Done in 27.83s` |
| Lint | `yarn lint` | ✅ sin errores (`Done in 98.47s`) |
| Unitarias | `yarn test` | ✅ **33 suites / 138 tests** pasan (incluye el nuevo spec) |
| Compose prod válido | `docker compose config --quiet` | ✅ `PROD-COMPOSE-VALID` |
| Compose dev válido | `docker compose -f … -f docker-compose.dev.yml config` | ✅ `DEV-COMPOSE-VALID`; `api`/workers con `read_only` off, target `development` |
| Build imagen prod | `docker compose build api` | ✅ target `runtime` por defecto; guardias `dist/workers/*` pasan |
| Arranque real | `docker compose up -d` | ✅ postgres/redis healthy, `migrate` exit 0, api + 4 workers running |
| Readiness | `GET /health/ready` | ✅ `database: ready, migrations: up-to-date, redis: ready` |
| Arranque workers | logs | ✅ `worker.started` en access y notifications |
| Métricas de cola | inserción de sondas + `GET /health/metrics` | ✅ `gym_sheet_outbox_jobs{status="PENDING"}=1`, `{status="DEAD_LETTER"}=1`, `backlog_age≈37s` |
| Cierre controlado | `docker compose stop -t 30 worker-access` | ✅ `worker.shutdown_requested` → `worker.stopped` |
| e2e | `yarn test:e2e` (Postgres desechable en :5433, esquema + migraciones como CI) | ✅ **2 suites / 26 tests** pasan; confirma bootstrap del `AppModule` con los cambios |
| Suite completa tras pendientes | `yarn test` | ✅ **34 suites / 142 tests** |
| Prune outbox (comportamiento real) | seed 5 jobs → dry-run → `--apply` en Postgres :5433 | ✅ dry-run `candidates=2, deleted=0`; apply `deleted=2`; sobreviven `recent-completed`, `old-pending`, `old-deadletter` (PENDING/DEAD_LETTER intactos) |
| Build artefactos nuevos | `yarn build` | ✅ `dist/workers/outbox-prune.command.js` y módulos de integración presentes |
| Hot-reload workers | `node --watch -r ts-node/register` | ✅ ejecuta y queda observando cambios |

Las sondas de métricas se eliminaron tras la comprobación (`DELETE 2`). El stack se bajó con
`docker compose down` conservando el volumen `postgres-data`. La base e2e desechable se eliminó
(`docker rm -f gymsheet-e2e-db`).

## Informe de optimizaciones

- **Recursos acotados**: todos los servicios ahora declaran `limits` (memoria + CPU) y
  `reservations`, evitando que un worker acapare CPU del host y dando al planificador margen de
  scheduling. Workers ligeros a `0.5` CPU, exercises-dataset a `1.0`.
- **Imagen de producción intacta y liviana**: el stage `development` se ubicó antes de `runtime`
  para no alterar el artefacto de producción (sin compilador, sin dev-deps, sin fuente).
- **Observabilidad sin coste creciente**: las métricas de cola consultan solo estados accionables,
  usando el índice existente; se evita deliberadamente un `COUNT` sobre `COMPLETED` (append-only).
- **Escalado documentado**: `--scale worker-*` sin cambios de código gracias a `SKIP LOCKED`.

## Registro de riesgos, decisiones y pendientes reales

**Decisiones**

- ADR-0005: outbox transaccional sobre PostgreSQL como única mensajería; no se añade broker.
- Entornos separados vía override de Compose (no se duplica el archivo de producción).

**Riesgos / pendientes reales (no resueltos aquí, con justificación)**

1. **Crecimiento de `integration.outbox_jobs`** → **resuelto (herramienta)**: comando de retención
   opt-in `db:outbox:prune` (dry-run por defecto, solo COMPLETED, borrado por lotes). No se
   auto-programa: lo dispara un scheduler externo. Pendiente futuro (solo si el volumen lo exige):
   particionado por tiempo. Riesgo residual: la retención depende de que el operador la programe.
2. **Latencia mínima acotada por polling** (`WORKER_POLL_INTERVAL_MS`) → **diferido con
   justificación**: la regla 50 exige medir antes de optimizar y no hay problema de latencia medido.
   Mejora evaluable primero: `LISTEN/NOTIFY` de PostgreSQL antes que cualquier broker.
3. **`reservations` en Compose no-Swarm** son best-effort (los `limits` sí se aplican). Para
   garantías duras de reserva se requeriría un orquestador (Swarm/Kubernetes).
4. **Hot-reload de workers en dev** → **resuelto**: `node --watch -r ts-node/register`
   (scripts `worker:*:dev`), sin añadir dependencias. API vía `nest --watch`.
5. **e2e ejecutado** contra una PostgreSQL desechable en `:5433` (esquema + migraciones como en CI):
   2 suites / 26 tests en verde. No se ejecutó la CI completa de `hardening-ci.yml` (audit de deps,
   backup/restore, load smoke, verificación de rate limit compartido y outage de Redis): son pasos de
   pipeline que corren en el runner de GitHub. Recomendado dejar que la CI los ejecute en el PR.
