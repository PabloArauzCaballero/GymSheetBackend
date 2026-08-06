---
type: operations
status: verified
last_reviewed: 2026-08-06
source_revision: 27f3fd2
tags: [backend, operations, deployment, docker]
---

# Despliegue

Runbook detallado ya existente (reutilizar, no duplicar):
`docs/operations/docker-and-messaging.md`. Esta nota condensa y enlaza.

## Topología de servicios (`docker-compose.yml`)

7 servicios en la red interna de Compose:

| Servicio | Imagen / comando | Rol |
|---|---|---|
| `postgres` | `postgres:16-alpine` | BD primaria + cola outbox. Aplica `docs/db/schema.sql` solo en primera creación |
| `redis` | `redis:7-alpine` (efímero, `--appendonly no`) | Contadores de rate limiting |
| `migrate` | `node dist/database/migrate.js up` (one-shot) | Aplica migraciones; exit ≠ 0 bloquea a la API |
| `api` | `node dist/main.js` | HTTP; publica `:3001→3000` |
| `worker-access` | `dist/workers/access-event.worker.js` | Consume `access_control.device_events` |
| `worker-reminders` | `dist/workers/membership-reminder.worker.js` | Barrido de recordatorios |
| `worker-notifications` | `dist/workers/notification-delivery.worker.js` | Consume `notifications.delivery` |
| `worker-exercises-dataset` | `dist/workers/exercises-dataset-refresh.worker.js` | Refresco del dataset |

## Orden de arranque (gated, no asumido)

`postgres` + `redis` **healthy** → `migrate` **completa** (`service_completed_successfully`) → `api`
y workers arrancan. Una instancia nunca sirve contra un esquema más viejo que su código. Detalle en
[[startup-shutdown]].

## Comandos

```bash
docker compose up -d --build                 # pila prod completa
docker compose logs -f worker-notifications  # seguir logs de un servicio
docker compose down                          # parar (conserva datos)
docker compose down -v                        # DESTRUCTIVO: borra el volumen de datos
# Desarrollo (hot reload):
docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build
```

## Imagen (`Dockerfile`)

Multi-stage: `builder` (compila TS y verifica que existan `dist/main.js`, `dist/database/migrate.js`
y los 4 workers, y que **no** exista `dist/src`), `dependencies` (solo prod), `development` (toolchain
hot reload, nunca default) y `runtime` (slim, non-root `node`, healthcheck de liveness, `tini` PID 1).

## Endurecimiento en Compose

`no-new-privileges:true`, `read_only: true` + `tmpfs /tmp`, `restart: unless-stopped`, límites de CPU
y memoria por servicio, healthcheck **deshabilitado** en workers (no exponen HTTP).

## Seguridad

Secretos solo por entorno (`${VAR:?...}`); ninguno con default usable. Métricas protegibles con
`METRICS_SCRAPE_TOKEN`. Ver [[configuration]] y [[../08-security/secrets-management]].

## Wikilinks

[[startup-shutdown]] · [[scaling]] · [[health-checks]] · [[rollback]] ·
[[../07-async-processing/queues]]
