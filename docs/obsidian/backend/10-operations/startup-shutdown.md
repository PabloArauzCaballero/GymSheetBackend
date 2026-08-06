---
type: operations
status: verified
last_reviewed: 2026-08-06
source_revision: 27f3fd2
tags: [backend, operations, lifecycle]
---

# Arranque y apagado

## Orden de arranque (gated)

`docker-compose.yml` **impone** el orden, no lo asume:

```text
postgres (healthy) + redis (healthy)
   → migrate (service_completed_successfully)   # migración ANTES que la API
      → api + worker-access + worker-reminders + worker-notifications + worker-exercises-dataset
```

- `migrate` es one-shot (`restart: "no"`): un exit ≠ 0 se trata como dependencia fallida, así **la
  API nunca arranca contra un esquema a medias**. Ver [[runbooks/failed-migration]].
- `postgres` aplica `docs/db/schema.sql` solo en primera creación del volumen; los cambios de esquema
  posteriores son responsabilidad de `migrate`.

## Arranque de un worker (`worker-bootstrap.ts`)

1. `NestFactory.createApplicationContext(module, { bufferLogs: true })`.
2. **`application.flushLogs()`** — imprescindible: sin esto un contexto no vuelca su buffer y el
   worker corre inobservable (no hay `listen()` que lo haga).
3. Registra `SIGTERM`/`SIGINT` (una vez).
4. `runner.run(controller.signal)`; emite `worker.started`.
5. Un fallo de arranque → `worker.bootstrap_failed` + `process.exitCode = 1`.

## Apagado controlado (graceful shutdown)

- Señal `SIGTERM`/`SIGINT` → `requestStop` emite **`worker.shutdown_requested`** (con `signalName`),
  aborta el `AbortController`.
- El abort corta el `sleep` en curso; el bucle `while (!signal.aborted)` termina, emite
  `worker.stopped`, y `finally` llama `application.close()`.
- Compose: `stop_grace_period: 45s` en workers (mayor que los 30s de la API) para terminar el job
  sostenido antes de morir. `tini` (PID 1) reenvía las señales.
- API: `enableShutdownHooks()` + `tini`; drena peticiones en vuelo dentro de 30s.

## Verificación (evidencia)

`docs/operations/docker-and-messaging.md` §Resilience testing:
`docker compose stop worker-access` debe mostrar `worker.shutdown_requested` y luego
`worker.stopped` dentro del grace period.

## Wikilinks

[[deployment]] · [[health-checks]] · [[rollback]] · [[../07-async-processing/workers]] ·
[[runbooks/failed-migration]]
