# Exercises Dataset connector

## Purpose

This connector synchronizes structured exercise data from
`hasaneyldrm/exercises-dataset`. Imported records use the
`EXERCISES_DATASET` data source; user-created records remain `CUSTOM` and are
never overwritten by the connector.

Application reads never call GitHub. The API serves the catalog from PostgreSQL,
so the last validated snapshot remains available during an upstream outage.

## External source and validation

The source URL is configured through `EXERCISES_DATASET_JSON_URL`. Before any
write, the client enforces HTTPS, a host allowlist, no credentials or custom port,
no redirects, timeout and byte limits, strict Zod validation, unique external IDs
and a minimum safe record count.

The runtime contract validates `id`, names, taxonomy, equipment, multilingual
instructions and steps, muscles, media paths, attribution and source timestamps.
The response SHA-256 and source version are stored as provenance.

## PostgreSQL cache and idempotency

The stable identity is:

```txt
(data_source = EXERCISES_DATASET, external_id = source.id)
```

After each daily download, the connector compares the validated snapshot SHA-256
and record count with the successful checkpoint. An identical structured-data
snapshot is a catalog no-op: no exercise row or `updated_at` value is rewritten;
only the freshness checkpoint advances. Media-enabled imports deliberately run
the reconciliation because media may have been enabled after the earlier import.

Changed imports update the same stable rows. Once every transactional batch succeeds,
external records absent from the complete snapshot are marked `INACTIVO`; they
are reactivated if they return in a later source snapshot. Custom records are
never included in that reconciliation.

The final reconciliation and successful-refresh checkpoint are committed in one
transaction. A partial import cannot advance the checkpoint.

## Daily refresh worker

`worker-exercises-dataset` checks the PostgreSQL checkpoint. It populates an empty
cache immediately, then downloads a new snapshot when the last fully successful
refresh is at least 24 hours old.

```txt
EXERCISES_DATASET_REFRESH_INTERVAL_MS=86400000
EXERCISES_DATASET_REFRESH_RETRY_MS=3600000
EXERCISES_DATASET_MIN_RECORDS=1000
```

Failure policy is stale-on-error: if download, validation or persistence fails,
the existing PostgreSQL catalog stays available and the worker retries after the
configured delay. A truncated response below the minimum safe count is rejected
before writes or deactivations.

Administrators can inspect cache scheduling without contacting the source:

```txt
GET /api/v1/admin/exercises/import/exercises-dataset/status
```

The existing administrator-only POST endpoint supports controlled manual imports
and dry runs:

```txt
POST /api/v1/admin/exercises/import/exercises-dataset
```

## Media licensing

Structured code/data is MIT according to the upstream repository. Images and GIFs
are attributed to Gym Visual and have separate terms, so safe defaults remain:

```txt
EXERCISES_DATASET_IMPORT_MEDIA=false
EXERCISES_DATASET_MEDIA_LICENSE_CONFIRMED=false
```

The worker synchronizes structured records daily without importing media unless a
deployer explicitly confirms the applicable media license.

For commercial-safe thumbnails, the same daily reconciliation optionally reads
`yuhonas/free-exercise-db`, published under the Unlicense. Only unambiguous exact
matches after name normalization are linked; unmatched exercises keep the
accessible UI fallback rather than receiving an incorrect image. The media
identity is stable and repeated runs do not create or update unchanged rows.

```txt
EXERCISES_OPEN_MEDIA_ENABLED=true
EXERCISES_OPEN_MEDIA_JSON_URL=https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/dist/exercises.json
EXERCISES_OPEN_MEDIA_BASE_URL=https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/exercises/
```

## Observability

Successful refresh logs include source URL, version, SHA-256, fetched time, record
count and create/update/deactivation counters. Failures state that cached rows were
preserved and include the retry delay. The checkpoint table is
`integration.exercise_dataset_sync_state`.
