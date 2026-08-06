---
type: integration
status: verified
last_reviewed: 2026-08-06
source_revision: 27f3fd2
tags: [backend, integration, exercises, dataset]
---

# Exercises dataset — visión general

Importación **entrante-por-pull** de un dataset público de ejercicios (y catálogo de media de dominio
público) hacia PostgreSQL, que actúa como caché local. Cliente: `ExercisesDatasetClient`; servicio:
`ExercisesDatasetService` (`src/modules/exercises/import/`).

## Cuándo se ejecuta

- Worker continuo `worker-exercises-dataset` (`ExercisesDatasetRefreshRunner`): refresco periódico
  auto-ajustado (ver [[../../07-async-processing/schedulers]]).
- Comando one-shot `db:sync:workoutkata` (`exercises-dataset-sync.command.ts`).
- Gating: **deshabilitado por defecto** (`EXERCISES_DATASET_ENABLED=false`). Con `false`,
  `importDataset` lanza `ServiceUnavailableException` y el worker solo duerme.

## Fuentes externas

| Fuente | Variable | Default |
|---|---|---|
| Dataset principal | `EXERCISES_DATASET_JSON_URL` | `raw.githubusercontent.com/hasaneyldrm/exercises-dataset/...` |
| Media pública (enriquecimiento) | `EXERCISES_OPEN_MEDIA_JSON_URL` / `_BASE_URL` | `raw.githubusercontent.com/yuhonas/free-exercise-db/...` |

## Configuración (`EXERCISES_DATASET_*` / `EXERCISES_OPEN_MEDIA_*`)

| Variable | Rol | Default |
|---|---|---|
| `EXERCISES_DATASET_ENABLED` | Habilita el conector | `false` |
| `EXERCISES_DATASET_ALLOWED_HOSTS` | Allowlist de host (anti-SSRF) | `raw.githubusercontent.com` |
| `EXERCISES_DATASET_TIMEOUT_MS` | Timeout de descarga | 15.000 |
| `EXERCISES_DATASET_MAX_RESPONSE_BYTES` | Tope de bytes de respuesta | 25.000.000 |
| `EXERCISES_DATASET_BATCH_SIZE` | Lote transaccional de upsert | 100 |
| `EXERCISES_DATASET_MIN_RECORDS` | Mínimo seguro de registros | 1000 |
| `EXERCISES_DATASET_REFRESH_INTERVAL_MS` | Intervalo de refresco | 86.400.000 (24 h) |
| `EXERCISES_DATASET_REFRESH_RETRY_MS` | Reintento tras fallo | 3.600.000 (1 h) |
| `EXERCISES_DATASET_IMPORT_MEDIA` | Importar media | `false` |
| `EXERCISES_DATASET_MEDIA_LICENSE_CONFIRMED` | Confirmación de licencia | `false` (requerida si media on) |
| `EXERCISES_OPEN_MEDIA_ENABLED` | Enriquecimiento con media libre | `true` |

## Seguridad de la descarga

HTTPS obligatorio, host en allowlist, sin credenciales ni puerto en la URL, `redirect: 'error'`,
lectura **acotada por bytes** (streaming con corte a `MAX_RESPONSE_BYTES`), validación de
`content-type` y del contrato con Zod. Detalle: [[contracts]] y [[failure-modes]].

## Caché y estado

Checkpoint en `integration.exercise_dataset_sync_state` (`content_sha256`, `record_count`,
`refreshed_at`). El caché PostgreSQL previo sobrevive a un fallo de refresco.

## Wikilinks

[[contracts]] · [[failure-modes]] · [[../../07-async-processing/batch-jobs]] ·
[[../index]] · [[../../08-security/secrets-management]]
