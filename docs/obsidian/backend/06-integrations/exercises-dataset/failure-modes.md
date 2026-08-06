---
type: integration
status: verified
last_reviewed: 2026-08-06
source_revision: 27f3fd2
tags: [backend, integration, exercises, failure-modes]
---

# Exercises dataset — modos de fallo

| Modo de fallo | Detección | Efecto | Mitigación |
|---|---|---|---|
| Conector deshabilitado | `EXERCISES_DATASET_ENABLED=false` | `importDataset` lanza `ServiceUnavailableException`; worker solo duerme | Habilitar solo si se necesita |
| URL no HTTPS / host no allowlisted / credenciales en URL | `validateSourceUrl` | `ServiceUnavailableException` | Corregir URL / `EXERCISES_DATASET_ALLOWED_HOSTS` |
| Redirección | `redirect: 'error'` | Descarga abortada (anti-SSRF) | Apuntar a URL directa |
| Timeout de descarga | `AbortController` / `AbortError` | `… exceeded the configured timeout.` | Ajustar `EXERCISES_DATASET_TIMEOUT_MS` |
| Respuesta demasiado grande | `content-length` o bytes > `MAX_RESPONSE_BYTES` | `… exceeds the configured byte limit.` (cancela lectura) | Revisar fuente; ajustar tope con criterio |
| Content-Type inesperado | `assertJsonResponse` | `… unexpected content type.` | Validar fuente |
| JSON inválido | `JSON.parse` falla | `… is not valid JSON.` | Validar fuente |
| No cumple contrato (Zod) | `externalExerciseDatasetSchema` | `… does not match the expected contract.` (+`issueCount`) | Revisar cambios upstream |
| Menos registros que el mínimo | `records.length < MIN_RECORDS` | `ServiceUnavailableException` | Protege contra dataset truncado; ajustar mínimo si legítimo |
| Media sin licencia confirmada | `importMedia && !MEDIA_LICENSE_CONFIRMED` | `ForbiddenException` | Confirmar licencia por env |
| Catálogo de media caído | `fetch` falla | Log `open_media_unavailable` (warn); continúa con caché | No bloquea el refresco de ejercicios |
| Fallo general del refresco | catch en el runner | `exercises_dataset.refresh_failed`; `sleep(REFRESH_RETRY_MS)`; caché previo intacto | Reintento automático; alerta por 3 fallos |
| Caché stale | checkpoint > intervalo | `getRefreshStatus().stale=true` | Alerta "Dataset cache stale > 26 h" |

## Aislamiento y durabilidad

- El caché PostgreSQL previo **siempre** sobrevive: un fallo de descarga no borra datos existentes.
- La importación es transaccional por lotes; un lote fallido no deja el catálogo a medias porque el
  checkpoint solo se escribe al completar.
- El fallo ocurre en el worker aislado, no en el hilo HTTP de la API.

## Señales

- Logs: `exercises_dataset.refresh_failed` / `refresh_completed` / `refresh_scheduled` /
  `snapshot_unchanged` / `batch_imported` / `open_media_unavailable`.
- Alertas (ver `docs/operations/observability-and-alerts.md`): "Connector failure" (3 fallos
  consecutivos), "Dataset cache stale" (checkpoint > 26 h).

## Wikilinks

[[overview]] · [[contracts]] · [[../../07-async-processing/batch-jobs]] ·
[[../../10-operations/runbooks/index]]
