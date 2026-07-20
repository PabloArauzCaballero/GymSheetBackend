# Exercise data, media, and external-source architecture

## Goals

The design must satisfy four independent needs:

1. Keep administrator-created global exercises.
2. Let each user create private personal exercises.
3. Synchronize a third-party exercise dataset idempotently.
4. Attach one or more licensed and accessible visual assets without storing large binaries in PostgreSQL.

## Aggregate boundaries

```txt
Exercise
├── exercise-equipment links
├── media metadata
└── source/provenance metadata

Workout session
└── ordered session exercise
    └── performed sets
```

`Exercise` is a reusable definition. `WorkoutSessionExercise` is an occurrence inside one session. `WorkoutSet` records actual performance. These concepts must not be merged.

## Exercise visibility

```txt
GLOBAL + ACTIVE
→ visible to authenticated users
→ writable only by administrators

PERSONAL + ACTIVE
→ visible only to creator
→ writable only by creator
```

Every read or write by identifier applies object-level authorization. A valid UUID alone never grants access.

## Source ownership

```txt
CUSTOM global
→ created by administrator
→ no external identity required

CUSTOM personal
→ created by user
→ createdByUserId required

EXERCISES_DATASET
→ global
→ externalId required
→ synchronized by connector
→ source metadata preserved
```

A connector may update only records under its own `dataSource`. This prevents imported data from overwriting manually curated records.

## Multimedia design

PostgreSQL stores references and metadata, not image or video bytes.

```txt
training.exercise_media
├── exerciseId
├── mediaType
├── provider
├── externalId
├── url
├── thumbnailUrl
├── mimeType
├── width / height
├── checksumSha256
├── altText
├── attribution / license
├── isPrimary / sortOrder
├── status
└── metadata
```

Reasons for a separate table:

- multiple images, GIFs, or videos per exercise;
- provider replacement without changing exercise identity;
- one active primary asset enforced by a partial unique index;
- soft inactivation and replacement history;
- accessible alternative text;
- attribution and license traceability;
- provider-specific metadata without polluting the exercise table;
- future image-processing jobs.

## Upload versus external reference

The current API accepts validated HTTPS references. It does not proxy arbitrary downloads or accept raw multipart uploads.

A future upload connector should use this flow:

```txt
client requests upload authorization
→ backend validates ownership, type, size, and quota
→ provider returns short-lived signed upload parameters
→ client uploads directly to object storage
→ backend verifies provider callback or asset metadata
→ backend creates exercise-media record
```

Required upload controls:

- MIME allowlist and file-signature verification;
- image dimension and byte limits;
- malware/content scanning where applicable;
- random provider identifiers;
- no user-controlled filesystem paths;
- signed URLs or authenticated delivery for private assets;
- thumbnail generation outside the HTTP request;
- idempotent callback handling;
- deletion and retention policy;
- attribution/license fields where content is not owned by the uploader.

## External dataset synchronization

The connector follows an anti-corruption boundary:

```txt
external JSON
→ source-specific Zod schema
→ validated ExternalExercise
→ mapper
→ internal Exercise + ExerciseMedia
```

The rest of the application never consumes the upstream shape directly.

### Stable identity

```txt
Exercise: (dataSource, externalId)
Media: (exerciseId, provider, externalId)
```

### Batch behavior

- The whole response is validated before writes.
- Records are split into configured batches.
- Each batch is transactional.
- A failed batch is rolled back without rolling back earlier completed batches.
- Repeating the import converges on the same source state.
- Source deletion is intentionally not propagated until a deletion policy is approved.

## Resource efficiency

- Exercise and session lists use capped pagination.
- Export reads sessions in bounded pages and rejects oversized synchronous exports.
- External responses are streamed with a byte cap.
- Database pool, acquisition, idle, connection, and statement timeouts are configured.
- Media bytes remain outside PostgreSQL and outside normal API memory.
- Request bodies have a global maximum size.
- Shutdown hooks close framework-managed resources.

## Migration strategy

The first hardening migration adds provenance fields to the legacy `public.ejercicios` table and creates new media data under `training`.

The existing repository predates the rule that application objects must not live in `public`. Moving every legacy table in one hardening change would expand deployment risk. Therefore:

1. New application tables use a dedicated schema.
2. Existing tables remain mapped explicitly to their current names for compatibility.
3. A separate staged migration must move legacy tables after dependency, grant, rollback, and downtime analysis.
4. Production approval must record this temporary deviation in an ADR.

## Failure modes

| Failure | Expected behavior |
|---|---|
| external timeout | import fails with 503; no current batch writes |
| redirect from source | request rejected |
| source contract drift | complete snapshot rejected before writes |
| duplicated external ID | validation fails |
| media license not confirmed | media import forbidden |
| invalid equipment relation | exercise write rejected before relation replacement |
| duplicate favorite or set | conflict response; database constraint remains authoritative |
| database unavailable | readiness returns 503; liveness remains available |

## Production observability

Record at minimum:

- request ID;
- route, method, status, latency;
- connector source version and SHA-256;
- records created/updated per batch;
- import failures without dumping source payloads;
- database query duration when explicitly enabled;
- media provider and asset identifier, never secret upload credentials.

Do not log access tokens, passwords, Authorization headers, cookies, database URLs, full third-party payloads, or private user notes.
