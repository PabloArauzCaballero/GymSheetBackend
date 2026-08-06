---
type: async-processing
status: verified
last_reviewed: 2026-08-06
source_revision: 27f3fd2
tags: [backend, async, batch, maintenance]
---

# Batch jobs (trabajos por lotes / mantenimiento)

## 1. Poda de retención del outbox (`db:outbox:prune`)

- Entrypoint: `outbox-prune.command.ts` (`OutboxMaintenanceModule` → `OutboxRetentionService`).
- **One-shot**, no worker. Lo dispara un scheduler externo (host cron, Kubernetes CronJob) contra la
  imagen runtime. No se auto-programa.
- **Seguro por defecto (dry-run):** sin `--apply` solo cuenta `COMPLETED` elegibles
  (`outbox.prune.dry_run`). Con `--apply` borra en lotes (`outbox.prune.completed`).
- Elegibilidad: solo `COMPLETED` con `processed_at < now() - OUTBOX_RETENTION_DAYS` (default 30 d).
  **Nunca** toca `PENDING`/`PROCESSING`/`FAILED`/`DEAD_LETTER`.
- Borrado en lotes de `OUTBOX_PRUNE_BATCH_SIZE` (default 1000) con `FOR UPDATE SKIP LOCKED`, así no
  contiende con el claim de los workers. Repite hasta drenar (lote corto = fin).

```bash
yarn db:outbox:prune                                  # dry run (ts-node)
node dist/workers/outbox-prune.command.js             # dry run (imagen runtime)
yarn db:outbox:prune --apply                          # borra COMPLETED elegibles
node dist/workers/outbox-prune.command.js --apply     # en contenedor / cron
```

Motivo (ADR-0005): las métricas de cola **no** cuentan `COMPLETED` para evitar un full-scan por
scrape; por eso la tabla se poda en vez de contarse. Pendiente futuro: particionado por tiempo.

## 2. Refresco del dataset de ejercicios (batch programado)

- Entrypoint continuo: `worker-exercises-dataset` (ver [[schedulers]]).
- Comando one-shot equivalente: `db:sync:workoutkata` (`exercises-dataset-sync.command.ts`), emite
  `workoutkata.sync.completed` / `workoutkata.sync.failed` con `correlationId` y contadores.
- `ExercisesDatasetService.importDataset` procesa el snapshot validado en **lotes transaccionales**
  de `EXERCISES_DATASET_BATCH_SIZE` (default 100), con upsert idempotente por `(dataSource,
  externalId)`, desactivación de faltantes y `writeSuccessfulCheckpoint` en
  `integration.exercise_dataset_sync_state`.
- Cortocircuito: si el `contentSha256` y el `recordCount` no cambiaron, marca `unchangedSnapshot` y
  solo reescribe el checkpoint (sin reimportar). Contrato y modos de fallo en
  [[../06-integrations/exercises-dataset/contracts]] y
  [[../06-integrations/exercises-dataset/failure-modes]].

## Idempotencia de estos batches

Ambos son re-ejecutables: la poda solo borra `COMPLETED` (repetible sin daño); la importación es
upsert por clave natural. Ver [[idempotency]].
