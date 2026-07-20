# GymSheet API endpoints

All routes use the configurable `API_PREFIX`; the default is `/api/v1`.

Authenticated routes require:

```http
Authorization: Bearer <access-token>
```

Successful JSON responses use:

```json
{
  "ok": true,
  "data": {}
}
```

Controlled errors use `application/problem+json` and include RFC 9457-compatible fields. Compatibility fields remain available for existing v1 clients:

```json
{
  "type": "about:blank",
  "title": "Bad Request",
  "status": 400,
  "detail": "El identificador debe ser un UUID válido.",
  "instance": "/api/v1/exercises/not-a-uuid",
  "requestId": "5c454f50-1b97-4b94-9ce7-5c85bff02a20",
  "timestamp": "2026-07-17T00:00:00.000Z",
  "ok": false,
  "statusCode": 400,
  "path": "/api/v1/exercises/not-a-uuid",
  "error": {
    "message": "El identificador debe ser un UUID válido.",
    "issues": {}
  }
}
```

The API does not return stack traces or raw infrastructure errors to clients. Unexpected production errors are also redacted from normal application logs.

## Global rules

- Route identifiers are validated as UUIDs before persistence access.
- `page` starts at 1.
- `pageSize` is capped at 100.
- Request bodies are capped by `REQUEST_BODY_LIMIT`.
- Administrative routes require an active database user with role `ADMIN`.
- Personal exercises, media, sessions, and sets enforce object ownership.
- Legacy Spanish v1 fields remain at the HTTP boundary; internal identifiers are English.
- Access tokens require the expected signature, expiration, issuer, audience, and algorithm.
- Every authenticated request revalidates the current user and role in PostgreSQL.

## Public operational endpoints

| Method | Route | Purpose |
|---|---|---|
| GET | `/health/live` | Process liveness without external dependency checks |
| GET | `/health/ready` | Readiness check including PostgreSQL |
| GET | `/health/metrics` | Prometheus-compatible HTTP, memory and database-pool metrics |
| GET | `/gateway/health` | Compatibility gateway health response |
| GET | `/gateway/routes` | Public capability summary without privileged route details |

Liveness remains independent of PostgreSQL to avoid restart loops during temporary database outages. Readiness returns `503` when the application should not receive traffic. Production ingress should restrict `/health/metrics` to the monitoring network even though the NestJS route is public for scraper compatibility.

## Authentication

| Method | Route | Access | Purpose |
|---|---|---|---|
| POST | `/auth/register` | public | Register a client account |
| POST | `/auth/login` | public | Authenticate and issue an access token |
| GET | `/auth/me` | authenticated | Return the revalidated request principal |

`register` and `login` use a tighter configurable rate limit than normal API routes. Login failures use a uniform message to reduce account enumeration.

## Users and profile

| Method | Route | Purpose |
|---|---|---|
| GET | `/users/me` | Return mapped persisted user data |
| GET | `/profile` | Read the caller's anthropometric profile |
| POST | `/profile` | Create or replace the caller's profile |
| PATCH | `/profile` | Update the caller's profile |

Canonical internal units are kilograms for body weight, centimeters for height, and explicit timestamps for measurement recency.

## Equipment

| Method | Route | Access | Purpose |
|---|---|---|---|
| GET | `/equipment` | authenticated | List available equipment |
| POST | `/admin/equipment` | ADMIN | Create equipment |
| PATCH | `/admin/equipment/:id` | ADMIN | Update equipment |
| DELETE | `/admin/equipment/:id` | ADMIN | Inactivate equipment without deleting history |

Exercise relationships accept only existing, linkable equipment identifiers. Input identifiers are deduplicated before persistence.

## Exercises

| Method | Route | Access | Purpose |
|---|---|---|---|
| GET | `/exercises` | authenticated | List global exercises and the caller's active personal exercises |
| GET | `/exercises/:id` | visible object | Read one visible exercise |
| POST | `/exercises/personal` | authenticated | Create a personal exercise |
| PATCH | `/exercises/:id` | owner | Update a personal exercise |
| DELETE | `/exercises/:id` | owner | Inactivate a personal exercise |
| POST | `/admin/exercises/global` | ADMIN | Create a global exercise |
| PATCH | `/admin/exercises/global/:id` | ADMIN | Update a global exercise |
| DELETE | `/admin/exercises/global/:id` | ADMIN | Inactivate a global exercise |

### `GET /exercises` filters

| Parameter | Type | Restriction |
|---|---|---|
| `page` | integer | minimum 1; default 1 |
| `pageSize` | integer | 1–100; default 25 |
| `search` | string | 1–120 characters |
| `grupoMuscular` | string | maximum 100 |
| `equipoId` | UUID | associated equipment |
| `bodyPart` | string | maximum 100 |
| `targetMuscle` | string | maximum 120 |
| `dataSource` | enum | `CUSTOM` or `EXERCISES_DATASET` |

The response contains `items`, `page`, `pageSize`, `total`, and `totalPages` inside `data`.

### Extended exercise fields

- `category`, `bodyPart`, `requiredEquipment`, `targetMuscle`, and `synergistMuscleGroup`;
- `secondaryMuscles`, maximum 30;
- localized `instructions` and `instructionSteps`;
- `metadata`, with a maximum serialized size of 16 KiB;
- `equipoIds`, maximum 30;
- source identity, version, URL, license, attribution, and import timestamp on imported records.

## Exercise media

| Method | Route | Access | Purpose |
|---|---|---|---|
| GET | `/exercises/:exerciseId/media` | exercise visible | List active media |
| POST | `/exercises/:exerciseId/media` | owner or ADMIN for global | Register a media reference |
| DELETE | `/exercise-media/:mediaId` | owner or ADMIN for global | Inactivate media and promote a replacement primary asset |

Controls:

- maximum ten active media records per exercise through the synchronous API;
- HTTPS URL with maximum length 2048;
- required useful `altText`;
- explicit provider and media type;
- optional attribution, license, dimensions, MIME type, and SHA-256;
- only one active primary asset per exercise, also enforced by the database;
- logical inactivation to preserve traceability.

Registering a URL does not grant copying or redistribution rights. External dataset media remains disabled unless deployment configuration explicitly confirms the applicable license.

## Favorite exercises

| Method | Route | Purpose |
|---|---|---|
| GET | `/user-exercises` | List the caller's favorite exercises |
| POST | `/user-exercises/:exerciseId` | Add a unique favorite |
| DELETE | `/user-exercises/:exerciseId` | Remove a favorite |

## Workout sessions

| Method | Route | Purpose |
|---|---|---|
| POST | `/workouts` | Start one session; only one open session per user |
| GET | `/workouts` | Read paginated history using `page` and `pageSize` |
| GET | `/workouts/:id` | Read a session owned by the caller |
| PATCH | `/workouts/:id/finish` | Complete an in-progress session |
| PATCH | `/workouts/:id/cancel` | Cancel an in-progress session |
| POST | `/workouts/:sessionId/exercises` | Add a visible exercise to an owned session |
| PATCH | `/workouts/session-exercises/:id` | Update an exercise occurrence in an open session |
| DELETE | `/workouts/session-exercises/:id` | Remove an exercise occurrence from an open session |
| POST | `/workouts/session-exercises/:id/sets` | Record a uniquely numbered set |
| PATCH | `/workouts/sets/:id` | Update an owned set |
| DELETE | `/workouts/sets/:id` | Delete an owned set |

Allowed session transitions:

```txt
EN_PROGRESO -> FINALIZADA
EN_PROGRESO -> CANCELADA
```

Completed or cancelled sessions reject further mutations.

## Exports

| Method | Route | Response | Purpose |
|---|---|---|---|
| GET | `/export/workout-history` | JSON envelope | Bounded export of the caller's history |
| GET | `/export/workout-history/csv` | `text/csv` | Downloadable CSV with formula neutralization |

Exports read history in pages to bound memory. Synchronous export rejects histories beyond the configured hard limit rather than allocating an unbounded payload.

## Dataset import

| Method | Route | Access | Purpose |
|---|---|---|---|
| POST | `/admin/exercises/import/exercises-dataset` | ADMIN | Validate and idempotently import the external exercise dataset |

The connector is disabled by default and applies:

- HTTPS-only source;
- host allowlist;
- redirect rejection;
- timeout and maximum response bytes;
- complete Zod validation before writes;
- bounded transactional batches;
- stable source identity for race-safe upserts;
- optional dry run;
- external media disabled by default;
- separate explicit media-license confirmation.

## Main status codes

- `400`: invalid input or route format;
- `401`: missing, invalid, expired token, or inactive user;
- `403`: role, ownership, license gate, or state transition denied;
- `404`: resource absent or not visible;
- `409`: uniqueness or business-state conflict;
- `413`: request or synchronous export too large;
- `429`: rate limit exceeded;
- `500`: unexpected error without sensitive details;
- `502`: invalid or unavailable external origin;
- `503`: dependency or connector unavailable.

## Source contracts

The primary OpenAPI contract is maintained at `docs/endpoints/openapi.yaml`. The observability endpoints introduced by hardening are also isolated in `docs/endpoints/openapi-observability.yaml` so infrastructure teams can import only the operational surface. The Postman collection mirrors the complete route inventory.

Controller, schema, route, response, error, or limit changes must update OpenAPI, this endpoint guide and the Postman collection in the same pull request.
