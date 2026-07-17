# Exercises Dataset connector

## Purpose

This connector imports exercise catalog data from `hasaneyldrm/exercises-dataset` without replacing the application's native exercise workflow. Imported records and user-created records coexist through the `dataSource` field:

- `CUSTOM`: manually created global or personal exercises.
- `EXERCISES_DATASET`: records synchronized from the external dataset.

The connector is administrator-only and disabled by default.

## Source contract

The runtime schema expects the documented dataset structure:

```txt
id
name
category
body_part
equipment
instructions
instruction_steps
muscle_group
secondary_muscles
target
media_id
image
gif_url
attribution
created_at
```

Unknown properties, malformed records, duplicate source identifiers, unexpected media paths, invalid dates, oversized values, and unsupported language keys are rejected before persistence.

## Import flow

```txt
POST /api/v1/admin/exercises/import/exercises-dataset
→ validate administrator role
→ verify feature flag
→ verify media-license gate when media is requested
→ validate HTTPS source and host allowlist
→ fetch with redirect rejection and timeout
→ stream with a maximum byte count
→ parse JSON as unknown
→ validate the complete dataset with Zod
→ calculate SHA-256 and source version
→ process bounded batches
→ upsert by (dataSource, externalId)
→ commit each batch transactionally
→ return import counters
```

## Idempotency

The stable identity is:

```txt
(data_source = EXERCISES_DATASET, external_id = source.id)
```

Repeated imports update the same exercise rather than creating duplicates. Media uses:

```txt
(exercise_id, provider, external_id)
```

Custom records do not share this identity and are never overwritten by the connector.

## Resource controls

- HTTP timeout: `EXERCISES_DATASET_TIMEOUT_MS`.
- Maximum response size: `EXERCISES_DATASET_MAX_RESPONSE_BYTES`.
- Transactional batch size: `EXERCISES_DATASET_BATCH_SIZE`.
- Redirect policy: rejected.
- Protocol: HTTPS only.
- Hosts: explicit allowlist.
- Dataset records: maximum enforced by the Zod schema.
- Media binaries are not downloaded by this API; only validated references and metadata are stored.

## Security model

The connector treats external data as hostile input. It implements controls corresponding to OWASP API7:2023 and API10:2023:

- no caller-controlled source URL;
- HTTPS and host allowlist;
- no URL credentials or custom ports;
- no redirects;
- request timeout;
- streamed byte limit;
- strict response contract;
- bounded batches;
- administrator authorization;
- no execution of source-provided HTML or scripts.

## Media licensing gate

The upstream repository licenses dataset code and structured data under MIT, while images and GIFs are attributed to Gym Visual and are governed by separate terms. Therefore:

```txt
EXERCISES_DATASET_IMPORT_MEDIA=false
EXERCISES_DATASET_MEDIA_LICENSE_CONFIRMED=false
```

are the safe defaults. Media references can be imported only after the deployer has independently confirmed that its intended use is authorized and sets both flags accordingly. The backend preserves attribution and license metadata but cannot grant rights that the deployer does not hold.

## Dry run

Request:

```json
{
  "dryRun": true,
  "importMedia": false
}
```

A dry run downloads and validates the complete snapshot, computes its fingerprint, and returns record counts without writing to PostgreSQL.

## Adding another source

Do not add conditionals to this connector. A new source requires its own:

```txt
<source>.schemas.ts
<source>.client.ts
<source>.repository.ts
<source>.service.ts
<source>.controller.ts
README.md
```

The source must define stable identity, licensing, provenance, retry behavior, resource limits, deletion semantics, and conflict resolution. Shared abstractions should be introduced only after real semantic repetition exists.

## Operational notes

- Imports are synchronous but bounded. Move them to a persistent worker if the dataset or execution time grows beyond the platform's HTTP timeout.
- Never enable scheduled imports without an explicit stale-data and failure-notification policy.
- Record counts and source fingerprints should be monitored for unexpected upstream changes.
- A source record disappearing from a later snapshot is not automatically deleted; deletion semantics require a separate business decision.
