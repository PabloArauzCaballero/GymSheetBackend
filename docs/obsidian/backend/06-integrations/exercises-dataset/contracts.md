---
type: integration
status: verified
last_reviewed: 2026-08-06
source_revision: 27f3fd2
tags: [backend, integration, exercises, contract]
---

# Exercises dataset — contrato

## Petición (`ExercisesDatasetClient.fetchSnapshot`)

- `GET` a `EXERCISES_DATASET_JSON_URL`.
- Cabeceras: `Accept: application/json`, `User-Agent: GymSheetBackend/1.0 exercises-dataset-connector`.
- `redirect: 'error'`; timeout `EXERCISES_DATASET_TIMEOUT_MS`.

### Validación de URL (`validateSourceUrl`)

Rechaza (con `ServiceUnavailableException`) si: no es HTTPS; host no está en
`EXERCISES_DATASET_ALLOWED_HOSTS`; o la URL trae `username`/`password`/`port`.

## Respuesta y validación

| Comprobación | Regla |
|---|---|
| Status | debe ser `response.ok`, si no → `HTTP <status>` |
| Content-Type | `application/json` \| `text/plain` \| `application/octet-stream` (`isSupportedDatasetContentType`) |
| Tamaño | `content-length` y bytes leídos ≤ `EXERCISES_DATASET_MAX_RESPONSE_BYTES` (corte en streaming) |
| JSON | `JSON.parse` válido, si no → excepción |
| Contrato | `externalExerciseDatasetSchema.parse` (Zod); en `ZodError` reporta `issueCount` sin volcar el payload |
| Mínimo | `records.length >= EXERCISES_DATASET_MIN_RECORDS` (si no, `ServiceUnavailableException`) |

## Versión y hash

- `contentSha256 = sha256(responseText)` → detecta snapshot sin cambios.
- `sourceVersion = normalizeVersionHeader(ETag) ?? contentSha256`.

## Snapshot devuelto

```text
{ records, sourceUrl, sourceVersion, contentSha256, fetchedAt }
```

## Idempotencia del import

Upsert por `(dataSource, externalId)`. Si `contentSha256` y `record_count` coinciden con el checkpoint
previo (`unchangedSnapshot`), solo reescribe el checkpoint (sin reimportar). Registros faltantes se
desactivan (`deactivateMissingExercises`). Ver [[../../07-async-processing/idempotency]].

## Catálogo de media (opcional)

`fetchOpenMediaCatalog` (si `EXERCISES_OPEN_MEDIA_ENABLED`): mismo patrón de seguridad; valida con
`openExerciseMediaCatalogSchema`. `resolveOpenMediaBaseUrl` reaplica la allowlist a
`EXERCISES_OPEN_MEDIA_BASE_URL`. La importación de media requiere
`EXERCISES_DATASET_MEDIA_LICENSE_CONFIRMED=true` (si no, `ForbiddenException`).

## Wikilinks

[[overview]] · [[failure-modes]] · [[../../07-async-processing/batch-jobs]]
