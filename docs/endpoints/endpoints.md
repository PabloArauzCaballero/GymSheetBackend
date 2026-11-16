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

A suspended account answers `code: ACCOUNT_SUSPENDED` — `403` at login/signup with the right credentials, `401` on any request with a still-valid token — with `details.pendingReview` (`true`: suspended while a report is reviewed, no end date) or `details.until` (ISO end of a dated suspension), and `details.reason: { code, label, text }`: the public reason of the sanction in force (the moderation reason code, its category and short text, the same words as the moderation notice; `MENOR_DE_EDAD` for the pending-review suspension; never the reporter, the moderator or the note). Clients compare the code; the message is for display.

An account banned by moderation (expulsion: `estado = INACTIVO` with an `EXPULSION` strike, not closed) answers `403 ACCOUNT_BANNED` with the same `details.reason` at login and at Google/Apple sign-in, **only after** the password (or the provider) proved the owner; a wrong password stays the generic `401 Credenciales inválidas.` (one bcrypt comparison as always), and any other inactive account keeps that generic `401`.

Suspension, expulsion, the provisional suspension of a minor report and the closure of a confirmed minor are also **emailed** to the address on file when decided: a self-contained job on `notifications.delivery` (`payload.kind = NOTICE_EMAIL` with `to`, `subject`, `body`; drained by the notifications worker through the mail transport, 10 attempts, dead-letter). The closure email is marked `survivesClosure` and outlives the closure that erases the inbox and anonymizes the address; every other pending notice email is dropped when the account closes.

`register` requires `genero` (`MALE`|`FEMALE`), `fechaNacimiento` (`YYYY-MM-DD`, 18–100) and `termsVersion`; an outdated version answers `409 TERMS_VERSION_OUTDATED`. The birth date is stored on the account (`usuarios.fecha_nacimiento`, the single source of age) and one row per document goes to `auth.terms_acceptances` in the same transaction.

## Legal acceptance

| Method | Route               | Access        | Purpose                                                                  |
| ------ | ------------------- | ------------- | ------------------------------------------------------------------------ |
| GET    | `/legal/current`    | public        | `{ documents: [{ document, version, contentSha256 }], consents: [{ kind, version }] }` (cacheable 5 min) |
| GET    | `/me/legal/pending` | authenticated | `{ pending: [{ document, version }] }` not yet accepted by the caller    |
| POST   | `/me/legal/accept`  | authenticated | `{ acceptances: [{ document, version }] }`; current versions only, idempotent |

A global guard answers `428 LEGAL_ACCEPTANCE_REQUIRED` to authenticated requests from an account missing any current document, except `auth/*`, `legal/*`, `me/legal/*`, `health/*`, `@Public()` and `@SkipLegalAcceptance()` routes. It costs one indexed `NOT EXISTS` query per authenticated request. The optional `X-Client-Platform` header (`web`|`ios`|`android`) is stored as the acceptance channel; the IP is stored only as an HMAC (`IP_HASH_SECRET`).

`contentSha256` is the SHA-256 of the exact published text (`yarn legal:hash <file>` at publish time; `null` for texts published before hashing). Each acceptance stores it in `auth.terms_acceptances.content_sha256`.

## Consents (ADR-0014)

| Method | Route                 | Access        | Purpose |
| ------ | --------------------- | ------------- | ------- |
| GET    | `/me/consents`        | authenticated | `{ consents: [{ kind, granted, version, currentVersion, upToDate, grantedAt, revokedAt }] }`, one entry per kind |
| PUT    | `/me/consents/:kind`  | authenticated | Body `{ granted: true, version }` or `{ granted: false }`; answers the updated entry |

`kind` is `HEALTH`, `ORIENTATION`, `VERIFICATION_SELFIE` or `PRECISE_LOCATION`. Granting needs the current version from `GET /legal/current` (`409 CONSENT_VERSION_OUTDATED` otherwise) and is idempotent; `X-Client-Platform` is stored as the channel. **Revoking erases the datum**: `HEALTH` the onboarding physical considerations, `ORIENTATION` the social-profile orientation and its visibility, `PRECISE_LOCATION` the stored map location (and turns the map off); `VERIFICATION_SELFIE` deletes every stored verification selfie (files go through the `media.release` queue) and cancels open attempts (`EXPIRED`), while an approval already given (`verified_at`, the decision record) stays. `POST /me/verification/challenge` and the selfie upload need an open `VERIFICATION_SELFIE` consent of the **current** version (`400 CONSENT_REQUIRED`, `details.kind = VERIFICATION_SELFIE`). Saving an orientation (`PUT /me/social-profile`) or a map location (`PATCH /me/social-map/location`) without the open consent answers `400 CONSENT_REQUIRED` with `details.kind`. A consent given to an older text stays valid and reports `upToDate: false`.

Turning the map off in `PATCH /me/social-discovery-settings` (or turning the social profile off) deletes the stored precise location. Deleting a chat message for everyone also deletes its encrypted file through the outbox queue `media.release` (on MinIO every version of the object is removed; kept only with `MEDIA_USER_CONTENT_DELETABLE=false`, ADR-0017).

Refresh tokens are opaque, hashed, and stored in `auth.refresh_tokens`; rotating one revokes it and issues a new one in the same family, and presenting an already-rotated token revokes the whole family (theft/reuse signal). Password-reset PINs live in `public.password_reset_tokens`: hashed with bcrypt, single-use, short-lived (`PASSWORD_RESET_PIN_TTL_MINUTES`, default 10) and capped at `PASSWORD_RESET_MAX_ATTEMPTS` wrong guesses (default 5) before the code is burned. `password-reset/request` always responds `202` with the same body, matched or not, to avoid account enumeration. The code is delivered by email through the messaging port (`NotificationChannel.EMAIL`); confirming the change also revokes every refresh token the account had open.

## Users and profile

| Method | Route       | Purpose                                  |
| ------ | ----------- | ---------------------------------------- |
| GET    | `/users/me` | Return mapped persisted user data (name and email change: see Account rights) |
| GET    | `/profile`  | Read the caller's anthropometric profile |
| POST   | `/profile`  | Create or replace the caller's profile   |
| PATCH  | `/profile`  | Update the caller's profile              |

Canonical internal units are kilograms for body weight, centimeters for height, and explicit timestamps for measurement recency.

## Account rights (franja 4)

| Method | Route                              | Access        | Purpose |
| ------ | ---------------------------------- | ------------- | ------- |
| PATCH  | `/me/account`                      | authenticated | Body `{ nombreCompleto }` (3–180, same rule as signup); answers the `/users/me` shape |
| POST   | `/me/email/change`                 | authenticated | Body `{ newEmail, password }`; `202 { accepted: true }` and a 6-digit PIN to the **new** address (sent even if taken, to avoid enumeration) |
| POST   | `/me/email/change/confirm`         | authenticated | Body `{ pin }`; swaps the email, `emailVerified` stays true, notifies the old address; `409` if another account holds it |
| GET    | `/me/account/closure-preview`      | authenticated | `{ allowed, proof: { password, emailPin }, account, deleted[], anonymized[], kept[] }`; each item `{ table, label, count, reason }` |
| POST   | `/me/account/closure-pin`          | authenticated | `202`; emails a closure PIN. Only for accounts linked to Google/Apple (`400 CLOSURE_PROOF_REQUIRED` otherwise) |
| DELETE | `/me/account`                      | authenticated (CLIENTE) | Body `{ password }` or `{ pin }` (exactly one); `200 { closed: true, closedAt }` |
| POST   | `/me/export`                       | authenticated | `202` with the export status; one request per 24 h (`429 ACCOUNT_EXPORT_RATE_LIMITED`, `details.retryAfterSeconds`) |
| GET    | `/me/export/latest`                | authenticated | `{ export: <status> \| null }`: the caller's most recent request, so a client that lost the id resumes it |
| GET    | `/me/export/:id`                   | owner         | `{ id, status: PENDING\|READY\|FAILED, requestedAt, completedAt, expiresAt, sizeBytes, downloadPath }` |
| GET    | `/me/export/:id/download`          | owner         | `application/json` attachment while `READY` and not expired (7 days); `409 ACCOUNT_EXPORT_NOT_READY` before |
| POST   | `/admin/users/:id/close`           | `ADMIN` (`SYSTEM_ADMIN` too) | Closes a **staff** account of the caller's gym (`ADMIN`, `COACH`, `FRONT_DESK`, `ENTRENADOR_EXTERNO`) with the same erasure, no password or PIN; `200 { closed: true, closedAt }`, audited in `admin.audit_log` (`domain: account`, `action: close`). Another gym's account, a platform admin or an already closed one: `404`; a member: `400 STAFF_CLOSURE_NOT_STAFF`; the caller's own account: `403 STAFF_CLOSURE_SELF`; the gym's last active admin: `403 STAFF_CLOSURE_LAST_ADMIN` |

All of them are exempt from the legal-acceptance gate and the password/PIN routes use the auth rate limit. Wrong password: `400 CURRENT_PASSWORD_INVALID`; PIN errors reuse `EMAIL_PIN_INVALID|EXPIRED|EXHAUSTED|COOLDOWN` (the PIN table is `auth.email_verification_pins` with `purpose` `VERIFY_EMAIL|CHANGE_EMAIL|CLOSE_ACCOUNT`, one live code, cooldown and daily cap per purpose). Someone else's export answers `404`.

**Closure** runs in one transaction driven by `src/modules/account/account-closure.catalog.ts` (the preview counts with the same predicates): sessions, devices, identities, PINs, notifications, health and training data, progression, Conocer, stories, reels, photos, comments, reviews and blocks are deleted; own chat messages are wiped like "delete for everyone" (the other person keeps theirs, the chat turns read-only), the system chats with REPP/the gym are deleted; consents are revoked; content under a moderation report, moderation records, the legal acceptances and the gym's tax records (memberships, payment orders with amounts and receipts, access log) are kept de-identified (notes and phone dropped, access credentials revoked). The account row is kept for FK integrity with email `cerrada-<id>@cuenta-cerrada.invalid`, name `Cuenta cerrada`, no birth date or sex, `estado = INACTIVO`, `closed_at` set and a random password hash: login answers the generic `401 Credenciales inválidas.` and the email can register again. Staff accounts answer `403 ACCOUNT_CLOSURE_STAFF`: their gym's admin closes them with `POST /admin/users/:id/close`. A staff closure keeps what members still use: routines it assigned to members (and the routines behind them, like the gym's official ones) stay, signed «Cuenta cerrada»; the members' chats with the gym it answered stay theirs (only the system chats where the closing account is the member side are deleted); its `membership.staff_profiles` row is marked `TERMINATED`. Files are erased after commit through the outbox queue `media.release` (one job per file, 8 attempts, dead-letter; drained by the API every minute), only when no other row references them; on MinIO every version is removed, and a rejected removal ends in dead-letter (ADR-0017). If the account has a running suspension or strikes still counting (365 days), they are kept under the keyed hash of the email in `moderation.closed_account_sanctions`; signing up again with that email (password or Google/Apple) inherits them, and a running suspension makes the signup answer `403` like the login (ADR-0015).

**Export** is built by the same worker (queue `account.export`): one section per data-map table (`src/modules/export/account-export.sections.ts`), own rows only, credential hashes omitted, chats limited to the caller's own messages and conversation ids, each table capped at the routine-progress export limit (20 000 rows, `truncated: true` beyond it). The archive lives in `auth.account_exports` and is purged when it expires. When it turns `READY` the owner gets, once per export, an in-app notice «Tu copia de datos está lista» (`metadata: { type: ACCOUNT_EXPORT_READY, exportId, downloadPath, expiresAt }`) and the same notice by email; a build that dead-letters turns `FAILED` and notifies «No pudimos preparar tu copia de datos» (`ACCOUNT_EXPORT_FAILED`) the same way.

**Evidence hold.** When the author deletes a profile photo (`DELETE /me/photos/:id`), a story (`DELETE /me/stories/:id`) or a community comment (`DELETE /comments/:commentId`) that has an **open** report, the call still answers success and the content disappears for everyone (author included: not listed, a second delete is `404`, it cannot be reported again), but the row and its file are kept as evidence: photos and stories get `author_deleted_at` plus `hidden_at` (a moderator's restore does not bring them back), a comment turns `BORRADO_AUTOR` keeping its text and attachment, and no `media.release` is requested. Once every report on it is closed, a photo or comment is erased by the reported-content retention 180 days after the last report closed (`REPORT_EVIDENCE_RETENTION_DAYS`; the file is then released through `media.release`), and a story by the stories purge as soon as no report on it is open and it has expired.

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
| PUT    | `/me/onboarding/preferences` | Save experience, frequency, location, consents (see below) |
| PUT    | `/me/onboarding/equipment`   | Save available equipment                         |
| POST   | `/me/onboarding/complete`    | Idempotently complete onboarding (`201`; `409`/`422`) |
| GET    | `/me/body-measurements`      | List the caller's body-measurement history       |
| POST   | `/me/body-measurements`      | Append a measurement without overwriting (`201`) |

The health consent is optional: `physicalConsiderations` with `consentHealth: false` answers `400 CONSENT_REQUIRED`; `consentHealth: true` records a `HEALTH` consent (optional `consentHealthVersion`, default the current one); `consentHealth: false` revokes it and keeps no text. `consentHealth` is no longer a missing field for `complete`.

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
