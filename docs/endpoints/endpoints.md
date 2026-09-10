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

| Method | Route             | Purpose                                                      |
| ------ | ----------------- | ------------------------------------------------------------ |
| GET    | `/health/live`    | Process liveness without external dependency checks          |
| GET    | `/health/ready`   | Readiness check including PostgreSQL                         |
| GET    | `/health/metrics` | Prometheus-compatible HTTP, memory and database-pool metrics |
| GET    | `/gateway/health` | Compatibility gateway health response                        |
| GET    | `/gateway/routes` | Public capability summary without privileged route details   |

Liveness remains independent of PostgreSQL to avoid restart loops during temporary database outages. Readiness returns `503` when the application should not receive traffic. Production ingress should restrict `/health/metrics` to the monitoring network even though the NestJS route is public for scraper compatibility.

## Authentication

| Method | Route                          | Access        | Purpose                                                       |
| ------ | ------------------------------ | ------------- | -------------------------------------------------------------- |
| POST   | `/auth/register`               | public        | Register a client account                                     |
| POST   | `/auth/login`                  | public        | Authenticate and issue an access token + refresh token        |
| POST   | `/auth/refresh`                | public        | Rotate a refresh token for a new access + refresh token pair  |
| POST   | `/auth/logout`                 | public        | Revoke a refresh token (idempotent)                            |
| POST   | `/auth/password-reset/request` | public        | Issue a 6-digit reset PIN by email (`202`, always)             |
| POST   | `/auth/password-reset/confirm` | public        | Redeem `{ email, pin, password }` for a new password           |
| GET    | `/auth/me`                     | authenticated | Return the revalidated request principal                       |

`register` and `login` use a tighter configurable rate limit than normal API routes. Login failures use a uniform message to reduce account enumeration.

Refresh tokens are opaque, hashed, and stored in `auth.refresh_tokens`; rotating one revokes it and issues a new one in the same family, and presenting an already-rotated token revokes the whole family (theft/reuse signal). Password-reset PINs are single-use, short-lived (`PASSWORD_RESET_TOKEN_TTL`, default 10 minutes), and capped at `PASSWORD_RESET_MAX_ATTEMPTS` wrong guesses (default 5) before the code must be requested again; `password-reset/request` always responds `202` with the same message, matched or not, to avoid account enumeration. No email provider is wired in yet — see `password-reset-notifier.ts`.

## Users and profile

| Method | Route       | Purpose                                  |
| ------ | ----------- | ---------------------------------------- |
| GET    | `/users/me` | Return mapped persisted user data        |
| GET    | `/profile`  | Read the caller's anthropometric profile |
| POST   | `/profile`  | Create or replace the caller's profile   |
| PATCH  | `/profile`  | Update the caller's profile              |

Canonical internal units are kilograms for body weight, centimeters for height, and explicit timestamps for measurement recency.

## Equipment

| Method | Route                  | Access        | Purpose                                       |
| ------ | ---------------------- | ------------- | --------------------------------------------- |
| GET    | `/equipment`           | authenticated | List available equipment                      |
| POST   | `/admin/equipment`     | ADMIN         | Create equipment                              |
| PATCH  | `/admin/equipment/:id` | ADMIN         | Update equipment                              |
| DELETE | `/admin/equipment/:id` | ADMIN         | Inactivate equipment without deleting history |

Exercise relationships accept only existing, linkable equipment identifiers. Input identifiers are deduplicated before persistence.

## Exercises

| Method | Route                         | Access         | Purpose                                                          |
| ------ | ----------------------------- | -------------- | ---------------------------------------------------------------- |
| GET    | `/exercises`                  | authenticated  | List global exercises and the caller's active personal exercises |
| GET    | `/exercises/:id`              | visible object | Read one visible exercise                                        |
| POST   | `/exercises/personal`         | authenticated  | Create a personal exercise                                       |
| PATCH  | `/exercises/:id`              | owner          | Update a personal exercise                                       |
| DELETE | `/exercises/:id`              | owner          | Inactivate a personal exercise                                   |
| POST   | `/admin/exercises/global`     | ADMIN          | Create a global exercise                                         |
| PATCH  | `/admin/exercises/global/:id` | ADMIN          | Update a global exercise                                         |
| DELETE | `/admin/exercises/global/:id` | ADMIN          | Inactivate a global exercise                                     |

### `GET /exercises` filters

| Parameter       | Type    | Restriction                     |
| --------------- | ------- | ------------------------------- |
| `page`          | integer | minimum 1; default 1            |
| `pageSize`      | integer | 1–100; default 25               |
| `search`        | string  | 1–120 characters                |
| `grupoMuscular` | string  | maximum 100                     |
| `equipoId`      | UUID    | associated equipment            |
| `bodyPart`      | string  | maximum 100                     |
| `targetMuscle`  | string  | maximum 120                     |
| `dataSource`    | enum    | `CUSTOM` or `EXERCISES_DATASET` |

The response contains `items`, `page`, `pageSize`, `total`, and `totalPages` inside `data`.

### Extended exercise fields

- `category`, `bodyPart`, `requiredEquipment`, `targetMuscle`, and `synergistMuscleGroup`;
- `secondaryMuscles`, maximum 30;
- localized `instructions` and `instructionSteps`;
- `metadata`, with a maximum serialized size of 16 KiB;
- `equipoIds`, maximum 30;
- source identity, version, URL, license, attribution, and import timestamp on imported records.

## Exercise media

| Method | Route                          | Access                    | Purpose                                                  |
| ------ | ------------------------------ | ------------------------- | -------------------------------------------------------- |
| GET    | `/exercises/:exerciseId/media` | exercise visible          | List active media                                        |
| POST   | `/exercises/:exerciseId/media` | owner or ADMIN for global | Register a media reference                               |
| DELETE | `/exercise-media/:mediaId`     | owner or ADMIN for global | Inactivate media and promote a replacement primary asset |

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

| Method | Route                         | Purpose                              |
| ------ | ----------------------------- | ------------------------------------ |
| GET    | `/user-exercises`             | List the caller's favorite exercises |
| POST   | `/user-exercises/:exerciseId` | Add a unique favorite                |
| DELETE | `/user-exercises/:exerciseId` | Remove a favorite                    |

## Workout sessions

| Method | Route                                  | Purpose                                            |
| ------ | -------------------------------------- | -------------------------------------------------- |
| POST   | `/workouts`                            | Start one session; only one open session per user  |
| GET    | `/workouts`                            | Read paginated history using `page` and `pageSize` |
| GET    | `/workouts/:id`                        | Read a session owned by the caller                 |
| PATCH  | `/workouts/:id/finish`                 | Complete an in-progress session                    |
| PATCH  | `/workouts/:id/cancel`                 | Cancel an in-progress session                      |
| POST   | `/workouts/:sessionId/exercises`       | Add a visible exercise to an owned session         |
| PATCH  | `/workouts/session-exercises/:id`      | Update an exercise occurrence in an open session   |
| DELETE | `/workouts/session-exercises/:id`      | Remove an exercise occurrence from an open session |
| POST   | `/workouts/session-exercises/:id/sets` | Record a uniquely numbered set                     |
| PATCH  | `/workouts/sets/:id`                   | Update an owned set                                |
| DELETE | `/workouts/sets/:id`                   | Delete an owned set                                |

Allowed session transitions:

```txt
EN_PROGRESO -> FINALIZADA
EN_PROGRESO -> CANCELADA
```

Completed or cancelled sessions reject further mutations.

## Exports

| Method | Route                         | Response      | Purpose                                      |
| ------ | ----------------------------- | ------------- | -------------------------------------------- |
| GET    | `/export/workout-history`     | JSON envelope | Bounded export of the caller's history       |
| GET    | `/export/workout-history/csv` | `text/csv`    | Downloadable CSV with formula neutralization |

Exports read history in pages to bound memory. Synchronous export rejects histories beyond the configured hard limit rather than allocating an unbounded payload.

## Dataset import

| Method | Route                                              | Access | Purpose                                                        |
| ------ | -------------------------------------------------- | ------ | -------------------------------------------------------------- |
| POST   | `/admin/exercises/import/exercises-dataset`        | ADMIN  | Validate and idempotently import the external exercise dataset |
| GET    | `/admin/exercises/import/exercises-dataset/status` | ADMIN  | Inspect PostgreSQL cache freshness and the next daily refresh  |

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

## Onboarding and body measurements

| Method | Route                        | Purpose                                          |
| ------ | ---------------------------- | ------------------------------------------------ |
| GET    | `/me/onboarding`             | Read onboarding state, current step and missing fields |
| PUT    | `/me/onboarding/profile`     | Save weight/height with explicit units and date  |
| PUT    | `/me/onboarding/goals`       | Save the primary fitness goal                    |
| PUT    | `/me/onboarding/preferences` | Save experience, frequency, location, consents   |
| PUT    | `/me/onboarding/equipment`   | Save available equipment                         |
| POST   | `/me/onboarding/complete`    | Idempotently complete onboarding (`201`; `409`/`422`) |
| GET    | `/me/body-measurements`      | List the caller's body-measurement history       |
| POST   | `/me/body-measurements`      | Append a measurement without overwriting (`201`) |

Body weight uses `KG`/`LB` and height `CM`/`IN` at the boundary; `measuredOn` is a date. Goals use the English `FitnessGoal` enum.

## Membership

| Method | Route                             | Access        | Purpose                                       |
| ------ | --------------------------------- | ------------- | --------------------------------------------- |
| GET    | `/membership/plans`               | authenticated | List commercial plans                         |
| GET    | `/membership/plans/:id`           | authenticated | Read one commercial plan                      |
| GET    | `/me/membership`                  | authenticated | Effective membership projection and actions   |
| GET    | `/me/accesses`                    | authenticated | Effective entitlements (not inferred from role) |
| GET    | `/me/membership/options`          | authenticated | Options compatible with current state         |
| POST   | `/me/membership/renewal-intent`   | authenticated | Register an idempotent renewal intent         |
| POST   | `/me/membership/extension-intent` | authenticated | Register an idempotent extension intent        |

> `GET /memberships/me` also exists (legacy plural path returning the current membership, `404` when none). It duplicates `/me/membership` and is pending unification; prefer `/me/membership`.

### Membership administration (`ADMIN`, some `FRONT_DESK`)

| Method | Route                                          | Access            |
| ------ | ---------------------------------------------- | ----------------- |
| GET/POST | `/admin/membership/plans`                    | GET ADMIN+FRONT_DESK / POST ADMIN |
| PATCH  | `/admin/membership/plans/:id`                  | ADMIN             |
| PATCH  | `/admin/membership/plans/:id/scopes`           | ADMIN             |
| POST/GET | `/admin/membership/customers`                | ADMIN+FRONT_DESK  |
| POST/GET | `/admin/membership/memberships`              | ADMIN+FRONT_DESK  |
| PATCH  | `/admin/membership/memberships/:id/status`     | ADMIN+FRONT_DESK  |
| POST   | `/admin/membership/staff`                      | ADMIN             |
| PATCH  | `/admin/membership/staff/:userId/status`       | ADMIN             |
| POST   | `/admin/membership/intents/:id/confirm`        | ADMIN             |

## Physical access control (`ADMIN`, some `FRONT_DESK`)

| Method | Route                                          | Access            |
| ------ | ---------------------------------------------- | ----------------- |
| GET    | `/access/me`                                   | authenticated     |
| GET/POST | `/admin/access/devices`                      | GET ADMIN+FRONT_DESK / POST ADMIN |
| PATCH  | `/admin/access/devices/:id/status`             | ADMIN             |
| GET    | `/admin/access/events/:id`                     | ADMIN+FRONT_DESK  |
| GET    | `/admin/access/history`                        | ADMIN+FRONT_DESK  |
| GET    | `/access/credentials/me`                       | authenticated     |
| POST   | `/admin/access/credentials/pin`                | ADMIN+FRONT_DESK  |
| POST   | `/admin/access/credentials/external-reference` | ADMIN+FRONT_DESK  |
| GET    | `/admin/access/credentials/user/:userId`       | ADMIN+FRONT_DESK  |
| PATCH  | `/admin/access/credentials/:id/revoke`         | ADMIN+FRONT_DESK  |
| POST   | `/admin/access/mock/events`                    | ADMIN             |

## Facilities (`ADMIN`, some `FRONT_DESK`)

| Method | Route                                             | Access           |
| ------ | ------------------------------------------------- | ---------------- |
| GET/POST | `/admin/facilities/branches`                    | GET ADMIN+FRONT_DESK / POST ADMIN |
| PATCH  | `/admin/facilities/branches/:id`                  | ADMIN            |
| GET/POST | `/admin/facilities/rooms`                       | GET ADMIN+FRONT_DESK / POST ADMIN |
| PATCH  | `/admin/facilities/rooms/:id`                     | ADMIN            |
| GET/POST | `/admin/facilities/access-points`               | GET ADMIN+FRONT_DESK / POST ADMIN |
| POST   | `/admin/facilities/equipment-assignments`         | ADMIN            |
| GET/POST | `/admin/facilities/maintenance`                 | ADMIN+FRONT_DESK |
| PATCH  | `/admin/facilities/maintenance/:id/start`         | ADMIN+FRONT_DESK |
| PATCH  | `/admin/facilities/maintenance/:id/complete`      | ADMIN+FRONT_DESK |

## Notifications

| Method | Route                          | Purpose                                |
| ------ | ------------------------------ | -------------------------------------- |
| GET    | `/notifications/me`            | List the caller's notifications (paged) |
| PATCH  | `/notifications/:id/read`      | Mark one notification as read          |
| GET    | `/notifications/preferences/me`| Read the caller's notification preferences |
| PATCH  | `/notifications/preferences/me`| Update preferences (`422` if channel disabled) |

## Routines and training

| Method | Route                          | Access        | Purpose                                    |
| ------ | ------------------------------ | ------------- | ------------------------------------------ |
| POST   | `/routines`                    | authenticated | Create a routine                           |
| GET    | `/routines`                    | authenticated | List routines (`scope` = `mine`\|`templates`) |
| GET    | `/routines/assignments/me`     | authenticated | Routines assigned to the caller            |
| GET    | `/routines/assignments/coach`  | COACH/ADMIN   | Routines the coach has assigned            |
| POST   | `/routines/import`             | authenticated | Bulk import routines (1–200)               |
| PATCH  | `/routines/exercises/:id`      | owner         | Update a routine exercise                  |
| DELETE | `/routines/exercises/:id`      | owner         | Remove a routine exercise                  |
| GET    | `/routines/:id`                | owner/visible | Read a routine                             |
| PATCH  | `/routines/:id`                | owner         | Update a routine (incl. `estado`)          |
| DELETE | `/routines/:id`                | owner         | Delete a routine                           |
| POST   | `/routines/:id/exercises`      | owner         | Add an exercise to a routine               |
| POST   | `/routines/:id/assign`         | COACH/ADMIN   | Assign a routine to a client               |
| POST   | `/routines/:id/start`          | owner         | Start a workout session from a routine     |

Physical access control, facilities and membership responses use the same `{ ok, data }` envelope and `application/problem+json` errors as the rest of the API. Full request/response schemas live in `openapi.yaml`.

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

The primary OpenAPI contract is maintained at `docs/endpoints/openapi.yaml` and covers the full client and administrative surface (auth, profile, onboarding, equipment, exercises, media, favorites, workouts, export, dataset import, membership, physical access control, facilities, notifications and routines). The observability endpoints introduced by hardening are isolated in `docs/endpoints/openapi-observability.yaml` so infrastructure teams can import only the operational surface. The Postman collection currently covers the core client and catalog flows (health, auth, profile, equipment, exercises, media, favorites, workouts, export) and does **not** yet mirror the full route inventory; onboarding, membership, access control, facilities, notifications and routines are pending.

Controller, schema, route, response, error, or limit changes must update OpenAPI, this endpoint guide and the Postman collection in the same pull request.
