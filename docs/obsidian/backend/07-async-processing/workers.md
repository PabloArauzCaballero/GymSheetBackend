---
type: async-processing
status: verified
last_reviewed: 2026-08-06
source_revision: 27f3fd2
tags: [backend, async, workers]
---

# Workers

El backend corre **4 workers** como procesos independientes de la API (`src/workers/`), cada uno
arrancado por `bootstrapWorker` (`worker-bootstrap.ts`) sobre un `ApplicationContext` de NestJS sin
superficie HTTP. Todos comparten el patrón de bucle de polling (`worker-loop.ts`: `sleep` cancelable
por `AbortSignal` y `runBounded` para concurrencia acotada) y cierre por `SIGTERM`/`SIGINT`.

> Fuente de verdad de la mensajería: [ADR-0005](../../../decisions/ADR-0005-messaging-transactional-outbox.md).
> Ver también [[queues]], [[retry-and-dead-letter]], [[ordering-and-concurrency]] y el runbook
> operativo `docs/operations/docker-and-messaging.md`.

## Tabla comparativa

| Aspecto | worker-access | worker-notifications | worker-reminders | worker-exercises-dataset |
|---|---|---|---|---|
| Entrypoint | `access-event.worker.ts` | `notification-delivery.worker.ts` | `membership-reminder.worker.ts` | `exercises-dataset-refresh.worker.ts` |
| Runner | `AccessEventRunner` | `NotificationDeliveryRunner` | `MembershipReminderRunner` | `ExercisesDatasetRefreshRunner` |
| Rol | Consumidor de cola | Consumidor de cola | Productor / scheduler | Batch programado |
| Trigger | Polling continuo | Polling continuo | Barrido cada `REMINDER_SCAN_INTERVAL_MS` | Barrido según intervalo del dataset |
| Fuente / payload | Tabla `access_control.device_events` (claim) | Cola outbox `notifications.delivery` (claim) | Membresías por vencer (scan) | Snapshot HTTP del dataset externo |
| Pasos | claim → `service.processEvent` (evalúa política, crea decisión) → complete/fail | claim → `delivery.deliver` (adapter) → complete/fail | scan → crea notificación + `recordAndEnqueue` a `notifications.delivery` | comprueba antigüedad → `importDataset` en lotes |
| Efectos | Decisión de acceso persistida; evento `access.decision-recorded` registrado | Notificación `SENT`/`FAILED`/`DEAD_LETTER`; `delivery_attempt` | Encola trabajos de entrega (idempotentes por `deduplication_key`) | Upsert de ejercicios/media + checkpoint de sync |
| Reintentos / backoff | Sí: `2^intento·2` s, tope **300 s** (`markEventFailed`) | Sí: `2^intento·5` s, tope **3600 s** (`markFailed`) | No por job; el scan reintenta al siguiente ciclo | No por registro; reintento global tras `EXERCISES_DATASET_REFRESH_RETRY_MS` |
| Timeout / lock | `WORKER_LOCK_TIMEOUT_MS` (lease) | `WORKER_LOCK_TIMEOUT_MS` (lease) | n/a (no hay lease de cola) | n/a (checkpoint en BD) |
| Lock / claim | `SELECT … FOR UPDATE SKIP LOCKED` + lease `locked_by`/`locked_at` | `SELECT … FOR UPDATE SKIP LOCKED` + lease | Ninguno (único productor; idempotencia por unique key) | Ninguno (single writer esperado) |
| Max attempts | `WORKER_MAX_ATTEMPTS` (default 5) | `job.maxAttempts` (default 5) / `WORKER_MAX_ATTEMPTS` | n/a | n/a |
| Concurrencia / batch | `WORKER_CONCURRENCY` × `WORKER_BATCH_SIZE` | `WORKER_CONCURRENCY` × `WORKER_BATCH_SIZE` | secuencial, `WORKER_BATCH_SIZE*10` candidatos | lotes de `EXERCISES_DATASET_BATCH_SIZE` |
| Métricas | `gym_sheet_outbox_*` cubre solo la cola outbox; **el access queue no se expone** (INFERIDO) | `gym_sheet_outbox_jobs{queue="notifications.delivery"}`, `gym_sheet_outbox_backlog_age_seconds` | vía cola destino (mismas métricas) | log `exercises_dataset.refresh_*`; alerta por checkpoint stale |
| Logs de arranque/cierre | `worker.started` / `worker.stopped` | `worker.started` / `worker.stopped` | `worker.started` / `worker.stopped` | `worker.started` / `worker.stopped` |
| `flushLogs()` en bootstrap | **Sí** (común) | **Sí** (común) | **Sí** (común) | **Sí** (común) |

## flushLogs y observabilidad

`bootstrapWorker` llama **`application.flushLogs()`** justo tras crear el contexto (los logs se
bufferizan con `bufferLogs: true`). Sin esa llamada un `ApplicationContext` nunca vuelca su buffer —
`NestFactory.create` lo hace en `listen()`, pero un contexto no escucha — y el worker correría
totalmente inobservable. Todos los workers heredan esta garantía porque comparten el mismo bootstrap.

Señales estructuradas por `event` que emite cada worker:

- `worker.started` (al arrancar) y `worker.stopped` (al drenar el bucle).
- `worker.shutdown_requested` (emitido por el bootstrap al recibir `SIGTERM`/`SIGINT`).
- `worker.bootstrap_failed` (fallo de arranque; `reportWorkerBootstrapError`, exit 1).
- Errores de dominio: `access_event.poll_failed` / `access_event.failed`,
  `notification_delivery.poll_failed` / `notification_delivery.failed` /
  `notification_delivery.lease_lost_after_delivery`, `membership_reminder.scan_failed`,
  `exercises_dataset.refresh_failed` / `refresh_completed` / `refresh_scheduled`.

En Docker los workers **no exponen HTTP**, por lo que su healthcheck está deshabilitado; la liveness
de proceso la cubre la política `restart: unless-stopped`. Ver [[../10-operations/health-checks]].

## Cierre controlado (graceful shutdown)

`worker-bootstrap.ts` registra `SIGTERM`/`SIGINT` una sola vez, emite `worker.shutdown_requested`,
aborta el `AbortController` (que corta el `sleep` en curso) y, tras terminar `runner.run`, ejecuta
`application.close()`. Compose asigna `stop_grace_period: 45s` a los workers (mayor que los 30s de la
API) para que un worker termine el job que sostiene antes de morir. Ver [[../10-operations/startup-shutdown]].

## Wikilinks

- Dominios: [[../03-domains/access-control/index]], [[../03-domains/notifications/index]], [[../03-domains/integration/index]]
- Estados de cola: [[../05-data/state-and-lifecycle-models]]
- Observabilidad: [[../09-observability/metrics]]
