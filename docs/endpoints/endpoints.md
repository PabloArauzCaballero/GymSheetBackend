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
- REPP operates the platform and the gym has no staff (ADR-0019, franja 7a): every `admin/*` route
  requires an active `SYSTEM_ADMIN` (impersonating a gym with `POST /auth/impersonate-tenant` to act
  on that gym), except social moderation, which also admits `MODERATOR` (see below). The old
  owner-gated `admin/directory/*` console no longer exists (franja 8d, ADR-0024): REPP does not
  manage a listing's payment data or orders (D9).
  Legacy gym roles (`ADMIN`, `FRONT_DESK`, `COACH`, `ENTRENADOR_EXTERNO`) get `403` on every
  `admin/*` route, whatever permission grants they hold.
- Account kinds (ADR-0020): a business account (`rol = NEGOCIO`, `accountKind = BUSINESS`) only
  reaches `auth/*` (not the socket ticket), `legal/*`, `me/legal/*`, `me/devices/*`, `health/*`,
  `business/*`, `public/*` and its notifications; anything else answers
  `403 ACCOUNT_KIND_NOT_ALLOWED`. A person gets the same `403` on `business/*`.
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

Liveness remains independent of PostgreSQL to avoid restart loops during temporary database outages. Readiness returns `503` when the application should not receive traffic. Production ingress should restrict `/health/metrics` to the monitoring network even though the NestJS route is public for scraper compatibility. Besides `gym_sheet_outbox_jobs{queue,status}`, the gauge `gym_sheet_outbox_dead_letter_jobs{queue="media.release"}` is always rendered (0 included): alert on `> 0` (ADR-0017 runbook).

## Authentication

| Method | Route                          | Access        | Purpose                                                       |
| ------ | ------------------------------ | ------------- | -------------------------------------------------------------- |
| POST   | `/auth/register`               | public        | Register a client account                                     |
| POST   | `/auth/login`                  | public        | Authenticate and issue an access token + refresh token        |
| POST   | `/auth/refresh`                | public        | Rotate a refresh token for a new access + refresh token pair  |
| POST   | `/auth/logout`                 | public        | Revoke a refresh token (idempotent)                            |
| POST   | `/auth/password-reset/request` | public        | Issue a 6-digit reset PIN by email (`202`, always)             |
| POST   | `/auth/password-reset/confirm` | public        | Redeem `{ email, pin, password }` for a new password           |
| GET    | `/auth/me`                     | authenticated | Return the revalidated request principal (`accountKind`, `businessEntityId`) |

`register` and `login` use a tighter configurable rate limit than normal API routes. Login failures use a uniform message to reduce account enumeration.

A suspended account answers `code: ACCOUNT_SUSPENDED` — `403` at login/signup with the right credentials, `401` on any request with a still-valid token — with `details.pendingReview` (`true`: suspended while a report is reviewed, no end date) or `details.until` (ISO end of a dated suspension), and `details.reason: { code, label, text }`: the public reason of the sanction in force (the moderation reason code, its category and short text, the same words as the moderation notice; `MENOR_DE_EDAD` for the pending-review suspension; never the reporter, the moderator or the note). Clients compare the code; the message is for display.

An account banned by moderation (expulsion: `estado = INACTIVO` with an `EXPULSION` strike, not closed) answers `403 ACCOUNT_BANNED` with the same `details.reason` at login and at Google/Apple sign-in, **only after** the password (or the provider) proved the owner; a wrong password stays the generic `401 Credenciales inválidas.` (one bcrypt comparison as always), and any other inactive account keeps that generic `401`.

Suspension, expulsion, the provisional suspension of a minor report, the end of that review without confirming a minor (in-app and email «Tu cuenta está activa otra vez», `metadata.type = MODERATION_MINOR_REVIEW_CLEARED`; when another sanction still keeps the account suspended, or the same review applies one, it says the account stays suspended instead; it never names the reporters) and the closure of a confirmed minor are also **emailed** to the address on file when decided: a self-contained job on `notifications.delivery` (`payload.kind = NOTICE_EMAIL` with `to`, `subject`, `body`; drained by the notifications worker through the mail transport, 10 attempts, dead-letter). The closure email is marked `survivesClosure` and outlives the closure that erases the inbox and anonymizes the address; every other pending notice email is dropped when the account closes.

`register` requires `genero` (`MALE`|`FEMALE`), `fechaNacimiento` (`YYYY-MM-DD`, 18–100) and `termsVersion`; an outdated version answers `409 TERMS_VERSION_OUTDATED`. The birth date is stored on the account (`usuarios.fecha_nacimiento`, the single source of age) and one row per document goes to `auth.terms_acceptances` in the same transaction.

## Legal acceptance

| Method | Route               | Access        | Purpose                                                                  |
| ------ | ------------------- | ------------- | ------------------------------------------------------------------------ |
| GET    | `/legal/current`    | public        | `?accountKind=PERSON\|BUSINESS` (default `PERSON`) → `{ documents: [{ document, version, contentSha256 }], consents: [{ kind, version }] }` (cacheable 5 min) |
| GET    | `/me/legal/pending` | authenticated | `{ pending: [{ document, version }] }` not yet accepted by the caller    |
| POST   | `/me/legal/accept`  | authenticated | `{ acceptances: [{ document, version }] }`; current versions only, idempotent |

A global guard answers `428 LEGAL_ACCEPTANCE_REQUIRED` to authenticated requests from an account missing any current document, except `auth/*`, `legal/*`, `me/legal/*`, `health/*`, `@Public()` and `@SkipLegalAcceptance()` routes. It costs one indexed `NOT EXISTS` query per authenticated request. The optional `X-Client-Platform` header (`web`|`ios`|`android`) is stored as the acceptance channel; the IP is stored only as an HMAC (`IP_HASH_SECRET`).

Each kind of account answers for its own set (ADR-0020): a person `TERMS`, `PRIVACY`, `COMMUNITY`; a business `BUSINESS_TERMS`, `BUSINESS_DPA`, `PRIVACY`. Accepting a document of the other set is `422 LEGAL_DOCUMENT_NOT_APPLICABLE`; the 428 carries `details.accountKind`. The business texts are drafts in `docs/legal/negocios/` (their hash is recomputed by a unit test).

`contentSha256` is the SHA-256 of the exact published text (`yarn legal:hash <file>` at publish time; `null` for texts published before hashing). Each acceptance stores it in `auth.terms_acceptances.content_sha256`.

## Consents (ADR-0014)

| Method | Route                 | Access        | Purpose |
| ------ | --------------------- | ------------- | ------- |
| GET    | `/me/consents`        | authenticated | `{ consents: [{ kind, granted, version, currentVersion, upToDate, grantedAt, revokedAt }] }`, one entry per kind |
| PUT    | `/me/consents/:kind`  | authenticated | Body `{ granted: true, version }` or `{ granted: false }`; answers the updated entry |

`kind` is `HEALTH`, `ORIENTATION`, `VERIFICATION_SELFIE` or `PRECISE_LOCATION` (the person set; `GET /legal/current` lists these). A business gives only `KYC_SELFIE`, through `PUT /business/me/kyc/consent` (`GET /legal/current?accountKind=BUSINESS` lists it, ADR-0021). Granting needs the current version from `GET /legal/current` (`409 CONSENT_VERSION_OUTDATED` otherwise) and is idempotent; `X-Client-Platform` is stored as the channel. **Revoking erases the datum**: `HEALTH` the onboarding physical considerations, `ORIENTATION` the social-profile orientation and its visibility, `PRECISE_LOCATION` the stored map location (and turns the map off); `VERIFICATION_SELFIE` deletes every stored verification selfie (files go through the `media.release` queue) and cancels open attempts (`EXPIRED`), while an approval already given (`verified_at`, the decision record) stays. `POST /me/verification/challenge` and the selfie upload need an open `VERIFICATION_SELFIE` consent of the **current** version (`400 CONSENT_REQUIRED`, `details.kind = VERIFICATION_SELFIE`). Saving an orientation (`PUT /me/social-profile`) or a map location (`PATCH /me/social-map/location`) without the open consent answers `400 CONSENT_REQUIRED` with `details.kind`. A consent given to an older text stays valid and reports `upToDate: false`. Current version of the four kinds: `2026-12-02` (the four checkbox texts changed; every grant recorded with `2026-12-01` now reports `upToDate: false` and the client asks again).

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
| POST   | `/admin/users/:id/close`           | `ADMIN` (`SYSTEM_ADMIN` too) | Closes a **staff** account of the caller's gym (`ADMIN`, `COACH`, `FRONT_DESK`, `ENTRENADOR_EXTERNO`) with the same erasure, no password or PIN; `200 { closed: true, closedAt }`, audited in `admin.audit_log` (`domain: account`, `action: close`). Another gym's account, a platform account (`SYSTEM_ADMIN`, `MODERATOR`) or an already closed one: `404`; a member: `400 STAFF_CLOSURE_NOT_STAFF`; the caller's own account: `403 STAFF_CLOSURE_SELF`; the gym's last active admin: `403 STAFF_CLOSURE_LAST_ADMIN` |

All of them are exempt from the legal-acceptance gate and the password/PIN routes use the auth rate limit. Wrong password: `400 CURRENT_PASSWORD_INVALID`; PIN errors reuse `EMAIL_PIN_INVALID|EXPIRED|EXHAUSTED|COOLDOWN` (the PIN table is `auth.email_verification_pins` with `purpose` `VERIFY_EMAIL|CHANGE_EMAIL|CLOSE_ACCOUNT`, one live code, cooldown and daily cap per purpose). Someone else's export answers `404`.

**Closure** runs in one transaction driven by `src/modules/account/account-closure.catalog.ts` (the preview counts with the same predicates): sessions, devices, identities, PINs, notifications, health and training data, progression, Conocer, stories, reels, photos, comments, reviews and blocks are deleted; own chat messages are wiped like "delete for everyone" (the other person keeps theirs, the chat turns read-only), the system chats with REPP/the gym are deleted; consents are revoked; content under a moderation report, moderation records, the legal acceptances and the gym's tax records (subscription periods, payment orders with amounts and receipts, access log, and the retired membership tables in schema `retired`) are kept de-identified (notes and phone dropped, access credentials revoked). The account row is kept for FK integrity with email `cerrada-<id>@cuenta-cerrada.invalid`, name `Cuenta cerrada`, no birth date or sex, `estado = INACTIVO`, `closed_at` set and a random password hash: login answers the generic `401 Credenciales inválidas.` and the email can register again. Staff accounts answer `403 ACCOUNT_CLOSURE_STAFF`: REPP's `SYSTEM_ADMIN` closes them with `POST /admin/users/:id/close` (ADR-0019). A staff closure keeps what members still use: routines it assigned to members (and the routines behind them, like the gym's official ones) stay, signed «Cuenta cerrada»; the members' chats with the gym it answered stay theirs (only the system chats where the closing account is the member side are deleted); its `membership.staff_profiles` row is marked `TERMINATED`. Files are erased after commit through the outbox queue `media.release` (one job per file, 8 attempts, dead-letter; drained by the API every minute), only when no other row references them; on MinIO every version is removed, and a rejected removal ends in dead-letter (ADR-0017). If the account has a running suspension or strikes still counting (365 days), they are kept under the keyed hash of the email in `moderation.closed_account_sanctions`; signing up again with that email (password or Google/Apple) inherits them, and a running suspension makes the signup answer `403` like the login (ADR-0015).

**Export** is built by the same worker (queue `account.export`): one section per data-map table (`src/modules/export/account-export.sections.ts`), own rows only, credential hashes omitted, chats limited to the caller's own messages and conversation ids, each table capped at the routine-progress export limit (20 000 rows, `truncated: true` beyond it). The archive lives in `auth.account_exports` and is purged when it expires. When it turns `READY` the owner gets, once per export, an in-app notice «Tu copia de datos está lista» (`metadata: { type: ACCOUNT_EXPORT_READY, exportId, downloadPath, expiresAt }`) and the same notice by email; a build that dead-letters turns `FAILED` and notifies «No pudimos preparar tu copia de datos» (`ACCOUNT_EXPORT_FAILED`) the same way.

**Evidence hold.** When the author deletes a profile photo (`DELETE /me/photos/:id`), a story (`DELETE /me/stories/:id`) a community comment (`DELETE /comments/:commentId`), or an upload to a personal exercise (`DELETE /exercise-media/:mediaId`, `DELETE /exercises/:id`) whose exercise has an **open** report, the call still answers success and the content disappears for everyone (author included: not listed, a second delete is `404`, it cannot be reported again), but the row and its file are kept as evidence: photos and stories get `author_deleted_at` plus `hidden_at` (a moderator's restore does not bring them back), a comment turns `BORRADO_AUTOR` keeping its text and attachment, an exercise upload gets `author_deleted_at` and turns `INACTIVE`, and no `media.release` is requested. Without an open report the row is deleted and its file is queued on `media.release` in the same transaction; the call answers success once the reference is cleared, and a storage failure is retried by the queue (ADR-0017 §4). Once every report on it is closed, a photo, comment or exercise upload (file and poster) is erased by the reported-content retention 180 days after the last report closed (`REPORT_EVIDENCE_RETENTION_DAYS`; the file is then released through `media.release`), and a story by the stories purge as soon as no report on it is open and it has expired.

## Equipment

| Method | Route                  | Access        | Purpose                                       |
| ------ | ---------------------- | ------------- | --------------------------------------------- |
| GET    | `/equipment`           | authenticated | List available equipment                      |
| POST   | `/admin/equipment`     | SYSTEM_ADMIN  | Create equipment                              |
| PATCH  | `/admin/equipment/:id` | SYSTEM_ADMIN  | Update equipment                              |
| DELETE | `/admin/equipment/:id` | SYSTEM_ADMIN  | Inactivate equipment without deleting history |

Exercise relationships accept only existing, linkable equipment identifiers. Input identifiers are deduplicated before persistence.

## Exercises

| Method | Route                         | Access         | Purpose                                                          |
| ------ | ----------------------------- | -------------- | ---------------------------------------------------------------- |
| GET    | `/exercises`                  | authenticated  | List global exercises and the caller's active personal exercises |
| GET    | `/exercises/:id`              | visible object | Read one visible exercise                                        |
| POST   | `/exercises/personal`         | authenticated  | Create a personal exercise                                       |
| PATCH  | `/exercises/:id`              | owner          | Update a personal exercise                                       |
| DELETE | `/exercises/:id`              | owner          | Inactivate a personal exercise and delete the files its owner uploaded to it |
| POST   | `/admin/exercises/global`     | SYSTEM_ADMIN   | Create a global exercise                                         |
| PATCH  | `/admin/exercises/global/:id` | SYSTEM_ADMIN   | Update a global exercise                                         |
| DELETE | `/admin/exercises/global/:id` | SYSTEM_ADMIN   | Inactivate a global exercise                                     |

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
| POST   | `/exercises/:exerciseId/media` | owner or SYSTEM_ADMIN for global | Register a media reference                               |
| DELETE | `/exercise-media/:mediaId`     | owner or SYSTEM_ADMIN for global | Inactivate media (delete it, file included, for an own upload to a personal exercise) and promote a replacement primary asset |

Controls:

- maximum ten active media records per exercise through the synchronous API;
- HTTPS URL with maximum length 2048;
- required useful `altText`;
- explicit provider and media type;
- optional attribution, license, dimensions, MIME type, and SHA-256;
- only one active primary asset per exercise, also enforced by the database;
- logical inactivation to preserve traceability, except for a member's own upload to a personal exercise.

An upload (`POST /exercises/:exerciseId/media/upload`) to a **personal** exercise is the owner's content: it is stored under `users/<owner>/ejercicios/<exerciseId>/` and is deleted for real (row plus a `media.release` job in the same transaction) when the media is deleted, when the exercise is deleted, when a re-upload with the same identity replaces it and when the account closes. Uploads to global (catalog) exercises stay under the immutable `ejercicios/<exerciseId>/` and are only inactivated. Rows uploaded before this change keep their `ejercicios/` keys (ADR-0017 §7).

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
| POST   | `/admin/exercises/import/exercises-dataset`        | SYSTEM_ADMIN | Validate and idempotently import the external exercise dataset |
| GET    | `/admin/exercises/import/exercises-dataset/status` | SYSTEM_ADMIN | Inspect PostgreSQL cache freshness and the next daily refresh  |

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

## Subscriptions (ADR-0026, franja 8e)

A subscription is a **period** of the ledger `membership.memberships`, opened by a confirmed marketplace
order (one order = one new period, never an extension in place). **Gym membership = confirmed SOCIO
affiliation + ACTIVE period** of a `MEMBERSHIP` listing of that gym. Day passes, class packs and coach or
centre services use the same ledger without affiliation. A product opens no period.

- Window: `startsOn = max(today, endsOn of the last ACTIVE period of the same listing + 1)`, `endsOn =
  startsOn + validityDays - 1` (validity as sold: the order's snapshot, never the listing edited later). A
  `DAY_PASS` lasts one day; a `CLASS_PACK`/`SERVICE_PACK` without validity has no end (`endsOn: null`); a
  `SERVICE_SESSION` counts one session. Dates in `BUSINESS_TIME_ZONE`.
- Shown status: `UPCOMING` (a renewal chained after the running one), `ACTIVE`, `EXPIRING` (≤ 7 days left),
  `EXPIRED`, `SUSPENDED`, `CANCELLED`; a line with only an open order is `PENDING`. `daysLeft` is 0 on the
  last day, null without an end.
- Legacy rows (`origin: LEGACY`, the gym-operated memberships before 8e) stay readable by their holder and
  are never shown to a business.
- The removed gym-operated machinery answers `404`: `/membership/plans[/:id]`, `/me/membership*`
  (options, renewal and extension intents, activation request), `/memberships/me`, `/me/accesses`, the whole
  `/admin/membership/*` (plans, features, scopes, customers, memberships, staff, intents, activation links,
  users, `insights/*` — `insights/lapsed` is replaced by `GET /business/me/subscriptions?status=EXPIRED`), and
  physical access control (`/access/me`, `/access/credentials/me`, `/admin/access/*`).

`Period`: `{ id, status, startsOn, endsOn, daysLeft, sessions: { total, used } | null, origin }`.

### Person (`me/subscriptions`; a business account gets `403 ACCOUNT_KIND_NOT_ALLOWED`; someone else's: `404`)

| Method | Route | Response | Codes |
| ------ | ----- | -------- | ----- |
| GET | `/me/subscriptions` | `{ today, items: [{ seller: { entityId, name, handle, logoUrl, entityType } \| null, affiliation: { id, status } \| null (the person's live SOCIO at that gym), subscriptions: [{ listing: { id, name, offerKind }, status, current: Period \| null, upcoming: Period \| null, pendingOrder: { id, orderNumber, status } \| null, renew: { listingId, available } \| null }] }] }` — running periods and those ended within a year (at most 200), grouped by seller and listing; `seller: null` is a legacy period of an unknown gym | `200` |
| GET | `/me/subscriptions/:id` | `Period` + `{ listing, seller: { entityId, name, handle } \| null, renew, history: [{ fromStatus, toStatus, reasonCode, at }] }` (never who made a change) | `200`, `404` |

### Business (`business/me/subscriptions`; `NEGOCIO` only — persons, `MODERATOR` and `SYSTEM_ADMIN`: `403`; another business's period: `404`)

| Method | Route | Body / response | Codes |
| ------ | ----- | --------------- | ----- |
| GET | `/business/me/subscriptions` | `?status=ACTIVE\|EXPIRING\|EXPIRED\|SUSPENDED\|CANCELLED&cursor&limit (≤ 50)` → `{ today, items: Subscriber[], nextCursor }`: the latest period of each (person, listing), soonest end first. `EXPIRING` = «por vencer», `EXPIRED` = «vencidos». `Subscriber` = `Period` + `{ subscriber: { displayName }, listing: { id, name, offerKind }, affiliation: { id, status, location } \| null, lastPayment: { orderNumber, amount, currency, method, paidAt } \| null, actions: { canCancel, canSuspend, canReactivate } }` — no email, user id or CI | `200`, `400` (`INVALID_CURSOR`) |
| GET | `/business/me/subscriptions/:id` | `Subscriber` | `200`, `404` |
| POST | `/business/me/subscriptions/:id/cancel` | strict `{ reasonCode: BUYER_REQUEST\|REFUNDED_BY_BUSINESS\|PAYMENT_ISSUE\|CONDUCT\|OTHER, note? (3–500; required with OTHER) }` → `Subscriber` (`CANCELLED`, final) | `200`, `400`, `404`, `409 SUBSCRIPTION_INVALID_TRANSITION`, `422 SUBSCRIPTION_NOTE_REQUIRED` |
| POST | `/business/me/subscriptions/:id/suspend` | strict `{ reasonCode: BUYER_REQUEST\|PAYMENT_ISSUE\|HEALTH\|CONDUCT\|OTHER, note? }` → `Subscriber` (`SUSPENDED`) | same |
| POST | `/business/me/subscriptions/:id/reactivate` | → `Subscriber` (`SUSPENDED` → `ACTIVE`) | `200`, `404`, `409` |

Each change is row-locked, appends a `membership.status_history` row with its domain event and tells the
person in-app (`subscription:{id}:{event}:{n}`). An ended period (shown `EXPIRED`) changes no more.

The reminder worker (`worker:reminders`) reads the ledger: an `ACTIVE` period ending in 7, 3, 1 or 0 days
gets one in-app reminder naming the plan and the seller, unless a renewal is already chained after it.

## Facilities (`SYSTEM_ADMIN`)

| Method | Route                                             | Access           |
| ------ | ------------------------------------------------- | ---------------- |
| GET/POST | `/admin/facilities/branches`                    | SYSTEM_ADMIN                      |
| PATCH  | `/admin/facilities/branches/:id`                  | SYSTEM_ADMIN     |
| GET/POST | `/admin/facilities/rooms`                       | SYSTEM_ADMIN                      |
| PATCH  | `/admin/facilities/rooms/:id`                     | SYSTEM_ADMIN     |
| GET/POST | `/admin/facilities/access-points`               | SYSTEM_ADMIN                      |
| POST   | `/admin/facilities/equipment-assignments`         | SYSTEM_ADMIN     |
| GET/POST | `/admin/facilities/maintenance`                 | SYSTEM_ADMIN     |
| PATCH  | `/admin/facilities/maintenance/:id/start`         | SYSTEM_ADMIN     |
| PATCH  | `/admin/facilities/maintenance/:id/complete`      | SYSTEM_ADMIN     |

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
| GET    | `/routines/assignments/me`     | authenticated | Routines assigned to the caller (assigning was removed in franja 7a; earlier assignments stay listed) |
| POST   | `/routines/import`             | authenticated | Bulk import routines (1–200)               |
| PATCH  | `/routines/exercises/:id`      | owner         | Update a routine exercise                  |
| DELETE | `/routines/exercises/:id`      | owner         | Remove a routine exercise                  |
| GET    | `/routines/:id`                | owner/visible | Read a routine                             |
| PATCH  | `/routines/:id`                | owner         | Update a routine (incl. `estado`)          |
| DELETE | `/routines/:id`                | owner         | Delete a routine                           |
| POST   | `/routines/:id/exercises`      | owner         | Add an exercise to a routine               |
| POST   | `/routines/:id/start`          | owner         | Start a workout session from a routine     |

Facilities and subscription responses use the same `{ ok, data }` envelope and `application/problem+json` errors as the rest of the API. Full request/response schemas live in `openapi.yaml`.

## Social moderation (central REPP team, ADR-0018)

Social moderation is done by the central REPP team, never by gym staff. Role `MODERATOR` is
platform-level: it works the queue of **every gym**; `SYSTEM_ADMIN` also enters (every gym, or only
the impersonated one). Gym roles (`ADMIN`, `FRONT_DESK`, `COACH`, …) get **`403`** on every route
below, whatever grants they hold: the `moderation:read` / `moderation:act` permissions no longer
exist (retired by migration `202611200101-platform-moderators`). No permission grant is needed by a
moderator.

| Method | Route | Access | Purpose |
| ------ | ----- | ------ | ------- |
| POST   | `/me/reports` | authenticated | Report content (unchanged) |
| GET    | `/admin/moderation/queue?page&pageSize≤50` | MODERATOR, SYSTEM_ADMIN | Open cases of every gym; each row (snake_case) carries `tenant_id` and `tenant_name` |
| GET    | `/admin/moderation/cases/:targetKind/:targetId` | MODERATOR, SYSTEM_ADMIN | Case file, with `tenantId` and the read-only snapshot of the reported target: `content` (by `content.kind`, below), `contentUnavailableReason` (`null`, `ERASED` when the target no longer exists, `CHAT_EVIDENCE` for a chat message) and `evidence` (chat message copy). Hidden content is included. Same `403 MODERATION_SELF_CASE` / `MODERATION_PEER_CASE` refusals (ADR-0018 §8) |
| POST   | `/admin/moderation/cases/:targetKind/:targetId/claim` | MODERATOR, SYSTEM_ADMIN | Claim (`409` if someone else holds it); audited `moderation/claim` |
| POST   | `/admin/moderation/cases/:targetKind/:targetId/release` | MODERATOR, SYSTEM_ADMIN | Release own claim; audited `moderation/release` |
| POST   | `/admin/moderation/cases/:targetKind/:targetId/resolve` | MODERATOR, SYSTEM_ADMIN | Verdict (hide/restore content, sanction, confirm/dismiss minor; `suspendBusiness` on marketplace cases, ADR-0022). Response adds `tenantId`, `resolution` and `businessSuspended`. Audited `moderation/resolve` with `metadata { caseKind, tenantId, resolution, sanction, contentHidden, minorConfirmed, businessSuspended, reportsClosed }` |
| GET    | `/admin/moderation/users/:userId/history` | MODERATOR, SYSTEM_ADMIN | Strike history |
| GET    | `/admin/signups` | MODERATOR, SYSTEM_ADMIN | Signup verdicts (a moderator sees every gym and the rejections) |
| GET    | `/admin/routines` | MODERATOR, SYSTEM_ADMIN | REPP routine console (official, hidden, open reports) |
| GET    | `/admin/platform/moderators` | SYSTEM_ADMIN | List the team `[{ id, email, nombreCompleto, estado }]` |
| PUT    | `/admin/platform/moderators/:userId` | SYSTEM_ADMIN | Make an active member account (`CLIENTE`) a `MODERATOR`; idempotent `200`. Unknown/closed: `404`; staff or `SYSTEM_ADMIN`: `409 MODERATOR_NOT_ASSIGNABLE`. Audited `moderation/moderator-assign` |
| DELETE | `/admin/platform/moderators/:userId` | SYSTEM_ADMIN | Back to `CLIENTE`, its claimed cases return to the queue; `204`, `404` if not a moderator. Audited `moderation/moderator-revoke` |

`content` of the case file (ADR-0018 §9) — the moderator reads the target here, never through the
author's routes (`GET /routines/:id` stays author or `SYSTEM_ADMIN`):

| `kind` | Fields |
| ------ | ------ |
| `ROUTINE` | `name`, `description`, `visibility`, `days[] { name, weekday (1 = Monday), exercises[] { name, sets, repsMin, repsMax, weightKg, durationSeconds } }` (day order, then exercise order; exercises without a day form a last unnamed day), `reach { copies, liveCopies, activations }` |
| `EXERCISE` | `name`, `description`, `muscleGroups[]`, `instructions[]` (Spanish steps, else English), `media[] { type, url }` |
| `COMMENT` | `text`, `attachmentUrl`, `attachmentType`, `deletedByAuthor` |
| `REEL`, `STORY`, `PROFILE_PHOTO` | `mediaUrl` (a reel: `/me/reels/:id/media`), `mediaType`, `caption` (stories only) |
| `USER` | `displayName`, `mainPhotoUrl` (first gallery photo, hidden or not); a closed account is `ERASED` |
| `MUSIC_PLAYLIST` | `name`, `url`, `type`, `imageUrl` (tracks are not stored: the playlist is a provider link) |
| `CHAT_MESSAGE` | `content: null`, the message is in `evidence` |
| `BUSINESS_LISTING`, `BUSINESS_PROFILE` | see «Moderation of the marketplace» (ADR-0022) |

Audit rows of a `MODERATOR` are platform rows (`tenant_scope` null). Every notice to the people
involved names «el equipo de moderación de REPP», never the gym.

**Who decides a case (ADR-0018 §8).** The case file, claim and verdict answer `403
MODERATION_SELF_CASE` when the reported account is the caller's own (any role), and `403
MODERATION_PEER_CASE` when a `MODERATOR` opens a case about a `MODERATOR` or `SYSTEM_ADMIN` account:
those cases belong to a `SYSTEM_ADMIN` who is not the reported account. The queue never lists the
caller's own cases, and lists cases about platform accounts to `SYSTEM_ADMIN` only. Release stays
open (it only hands an own claim back). Refusals log `moderation.case_refused`.

### Person verification review (selfie, central REPP team)

The selfie review follows the same rule: a selfie is biometric data and the gym never sees it.
`MODERATOR` reviews every gym, `SYSTEM_ADMIN` every gym or only the impersonated one; `ADMIN`,
`FRONT_DESK` and every other gym role get **`403`**, retired `moderation:*` grants or not.
The case rule of ADR-0018 §8 applies too: nobody reviews their own selfie (`403
MODERATION_SELF_CASE`), a `MODERATOR` never opens or decides a `MODERATOR`/`SYSTEM_ADMIN` attempt
(`403 MODERATION_PEER_CASE`), and the queue hides both from whoever may not decide them.

| Method | Route | Access | Purpose |
| ------ | ----- | ------ | ------- |
| GET    | `/admin/verifications?status(default PENDING_REVIEW)&limit≤50` | MODERATOR, SYSTEM_ADMIN | Oldest first, every gym: `[{ id, status, member { id, name }, tenantId, tenantName, gesture { code, instruction }, submittedAt, selfie { url, expiresAt } \| null, profilePhotos [{ id, url }] }]`. `selfie.url` is a 5-minute link signed for the caller |
| GET    | `/admin/verifications/:id/selfie?expires&signature` | MODERATOR, SYSTEM_ADMIN | Decrypted image (`private, no-store`). Expired, forged or another moderator's link: `403`; out of scope or erased: `404` |
| POST   | `/admin/verifications/:id/decide` | MODERATOR, SYSTEM_ADMIN | `{ decision: APPROVE, comparedPhotoIds }` or `{ decision: REJECT, reason }` → `200 { id, status, submittedAt }`. Gallery changed: `409 VERIFICATION_PHOTOS_CHANGED`; no photos left: `409 VERIFICATION_PHOTOS_REQUIRED`; already decided: `409 VERIFICATION_STATE_CONFLICT`; expired (review deadline or consent revoked): `409 VERIFICATION_CHALLENGE_EXPIRED`. Audited `verification/decide` (`target_kind photo_verification`) with `metadata { tenantId, decision, reason }` |

**Review deadline (ADR-0014).** An attempt that waits in `PENDING_REVIEW` more than
`VERIFICATION_REVIEW_DEADLINE_DAYS` (30) after `submittedAt` becomes `EXPIRED` in the daily privacy
retention, leaves the queue, and its selfie is erased through `media.release`. The member gets an
in-app notice (`metadata.outcome = REVIEW_EXPIRED`, dedup `verification.review-expired:<id>`),
`GET /me/verification` reports `status: EXPIRED`, and a new `POST /me/verification/challenge` is
allowed. The decision notices name «el equipo de REPP», never the gym.

## Business accounts (ADR-0020, franja 8a)

Session responses (`register`, `login`, `refresh`, `business/signup`) carry `user.accountKind`
(`PERSON`|`BUSINESS`). Errors are `application/problem+json` with a stable `code`.

| Method | Route | Access | Body → response | Codes |
| ------ | ----- | ------ | --------------- | ----- |
| POST | `/business/signup` | public, auth rate limit, `BUSINESS_SIGNUP_ENABLED` | `{ email, password (8–128), businessName (2–180), entityType: GYM\|COACH\|CENTER\|STORE\|SERVICE_PROVIDER, legalKind?: COMPANY\|INDIVIDUAL (only SERVICE_PROVIDER, required there), acceptances: [{ document, version, contentSha256? }] (the whole set of `/legal/current?accountKind=BUSINESS`), ticket, website?, turnstileToken?, attestation? }` → session `{ accessToken, refreshToken, tokenType, user: { id, email, nombreCompleto, rol: NEGOCIO, tenantId, emailVerified: false, accountKind: BUSINESS }, business: { entityId, entityType, legalKind, status: ONBOARDING, kycStatus: DRAFT } }`; a 6-digit PIN is emailed | `201`; `400` (Zod, `SIGNUP_REJECTED`, `BUSINESS_LEGAL_KIND_INVALID`); `403 ACCOUNT_SUSPENDED` (inherited sanction); `404 BUSINESS_SIGNUP_DISABLED`; `409 EMAIL_ALREADY_REGISTERED`, `409 TERMS_VERSION_OUTDATED` (`details.documents`); `422 BUSINESS_NAME_INVALID\|BUSINESS_NAME_RESERVED\|BUSINESS_NAME_TOO_SIMILAR`; `429` |
| GET | `/business/me` | `NEGOCIO` | `{ account: { userId, email, emailVerified, accountKind, entityId, entityType, legalKind, status, kycStatus, createdAt }, entity: { id, slug, entityType, status, isVerified, name, headline, description, primaryCategoryId, city, country, address, isOnlineOnly, logoUrl, coverUrl, contactInfo, businessHours }, handle: { handle, status: PENDING\|ACTIVE } \| null, nextSteps: [VERIFY_EMAIL, CHOOSE_HANDLE, COMPLETE_PROFILE, SUBMIT_KYC] }` | `200`, `403`, `428` |
| PATCH | `/business/me/profile` | `NEGOCIO`, verified email | any of `{ name, headline\|null, description (≤5000), primaryCategoryId (active, scope = type or ALL), city, country, address\|null, isOnlineOnly, contactInfo: { phone\|whatsapp\|email\|website\|instagram\|facebook\|tiktok: string }, businessHours: { mon..sun: { open: HH:MM, close: HH:MM } } }` (unknown keys → `400`) → same as `GET /business/me`; `name` also renames the account. `name` and `primaryCategoryId` are material: while DRAFT a new name passes the name checks (reserved words, REPP brands, same skeleton as a public listing of the type); past DRAFT changing either is refused (sending the current value is not a change) | `200`, `400`, `403 EMAIL_VERIFICATION_REQUIRED`, `409 BUSINESS_ACCOUNT_LOCKED`, `409 BUSINESS_MATERIAL_CHANGE_REQUIRES_REVIEW`, `422 BUSINESS_NAME_INVALID\|BUSINESS_NAME_RESERVED\|BUSINESS_NAME_TOO_SIMILAR` |
| PUT | `/business/me/handle` | `NEGOCIO`, verified email | `{ handle }` (a leading `@`, spaces and case are normalized) → `{ handle, status: PENDING\|ACTIVE }` | `200`; `409 HANDLE_TAKEN`, `409 BUSINESS_ACCOUNT_LOCKED`, `409 HANDLE_RESERVATION_EXPIRED` (DRAFT listing created 14+ days ago; re-claiming never extends the reservation); `422 HANDLE_INVALID\|HANDLE_RESERVED\|HANDLE_TOO_SIMILAR`; `429 HANDLE_RENAME_LIMIT` |
| POST | `/business/me/media` | `NEGOCIO`, verified email | multipart `file` (JPEG/PNG, ≤ `MEDIA_UPLOAD_MAX_BYTES`, bytes must match) + `slot: LOGO\|COVER` → `{ slot, url }` (public, `business/{entityId}/public/…`); the replaced file is released (ADR-0017) | `201`, `400`, `413` |
| DELETE | `/business/me/media/:slot` | `NEGOCIO` | removes the logo or cover | `204`, `400` |
| GET | `/public/handles/:handle` | public | `{ handle, entity: <public directory detail> }` for an ACTIVE handle of an ACTIVE listing; `{ redirectTo }` for a handle retired less than 90 days ago | `200`, `404` |
| GET | `/public/handles/:handle/availability` | public, `HANDLE_AVAILABILITY_RATE_LIMIT_MAX` | `{ handle (normalized \| null), available, reason: null\|TAKEN\|RESERVED\|INVALID\|TOO_SIMILAR }` | `200`, `429` |

Handle rules: 3–30 of `[a-z0-9._]`, starting and ending alphanumeric, no double separators, not only
digits; plain ASCII after NFKC. Look-alikes collide (`.`/`_` dropped, `0→o 1→l i→l 5→s 3→e`).
Reserved words (and `repp` anywhere) are refused. While the listing is `DRAFT` the handle is a
**PENDING reservation**: not public, freely replaceable, expired 14 days after the listing was
created unless the KYC was already sent once. It becomes `ACTIVE` with the KYC approval
(`AUTO_APPROVED`/`APPROVED`, ADR-0021). While the KYC is `SUBMITTED`/`IN_REVIEW` the handle, the
name and the category do not change (`409 KYC_NOT_EDITABLE`). A public rename: at most one every 30 days and three per year; the old handle redirects
for 90 days and is locked for 180.

Email verification uses the person routes (`POST /auth/email/verify/request|confirm`).

## Business KYC (ADR-0021, franja 8b)

All routes: `NEGOCIO`, verified email, business legal set accepted (else `428`). A person gets
`403 ACCOUNT_KIND_NOT_ALLOWED`. Without `KYC_ENCRYPTION_KEY`/`IP_HASH_SECRET`: `503 KYC_UNAVAILABLE`.
A suspended or closed account: `409 BUSINESS_ACCOUNT_LOCKED`. Only a `DRAFT` attempt is editable:
`409 KYC_NOT_EDITABLE` with `details.action` `WAIT` (in review), `RESUBMIT` (rejected) or `CHANGE`
(approved: open a material change).

| Method | Path | Body → response | Codes |
|---|---|---|---|
| POST | `/business/me/phone/verify/request` | `{ phone }` (Bolivian mobile, `+591` optional, 8 digits starting 6/7) → `{ phoneMasked: "+591 •••••567", codeSent, expiresAt\|null }`; a 6-digit code goes by WhatsApp. `codeSent: false` = no provider (the KYC will go to review) | `202`, `400 PHONE_INVALID`, `429 PHONE_OTP_RATE_LIMITED {retryAt}` (60 s, 5/h), `503 PHONE_OTP_UNAVAILABLE` (provider failed) |
| POST | `/business/me/phone/verify/confirm` | `{ code: "123456" }` → `{ phoneMasked, verified: true, verifiedAt }` | `200`, `400 PHONE_OTP_INVALID {attemptsLeft}`, `409 PHONE_OTP_NOT_REQUESTED`, `410 PHONE_OTP_EXPIRED` (10 min), `429 PHONE_OTP_EXHAUSTED` (5), `503 PHONE_OTP_UNAVAILABLE` (no provider) |
| GET | `/business/me/kyc` | → `{ kycStatus, accountStatus, badge: VERIFIED\|NEW\|null, submission: Submission\|null, missing: string[], phone: { phoneMasked, verified, verifiedAt }\|null, consent: { kind: KYC_SELFIE, granted, upToDate, currentVersion }, attempts: { used, max: 3, resubmitAvailableAt, canResubmit }, lastDecision: { decision, reasonCodes, reasons, allowResubmit, decidedAt }\|null }` | `200` |
| PUT | `/business/me/kyc/draft` | any of `{ legalName, nit, repFullName, repCiNumber, repCiComplement (2), repCiExtension: LP\|CB\|SC\|OR\|PT\|TJ\|CH\|BE\|PD, specialty, address, seprecNumber }` (`null` clears; COMPANY: no `specialty`; INDIVIDUAL: no `legalName`/`nit`/`seprecNumber`); `tradeName`, `primaryCategoryId` only in a material change → `Submission`. The first save creates the draft | `200`, `400`, `409 KYC_NOT_EDITABLE`, `422 KYC_FIELD_INVALID {field, reason: FORMAT\|NOT_APPLICABLE\|INCOMPLETE}`, `422 BUSINESS_NAME_*` |
| PUT | `/business/me/kyc/consent` | `{ granted: true, version: "2026-11-16" }` or `{ granted: false }` (revoking erases stored selfies) → `{ kind: KYC_SELFIE, granted, version, currentVersion, upToDate, grantedAt, revokedAt }` | `200`, `400`, `409 CONSENT_VERSION_OUTDATED {currentVersion}` |
| POST | `/business/me/kyc/selfie-challenge` | → `{ code, instruction, expiresAt }` (15 min, one use, never the previous gesture) | `201`, `400 CONSENT_REQUIRED {kind: KYC_SELFIE}`, `409 KYC_NOT_EDITABLE` |
| POST | `/business/me/kyc/documents` | multipart `file` (JPEG/PNG by bytes, ≤ 8 MB) + `kind: CI_FRONT\|CI_BACK\|SELFIE\|SEPREC` → `{ id, kind, readable, readabilityCodes: (TOO_SMALL\|LOW_CONTRAST\|TOO_DARK\|TOO_BRIGHT\|UNDECODABLE)[], width, height, uploadedAt }`; the same kind again replaces it. `readable: false` = ask for another photo | `201`, `400 KYC_DOCUMENT_UNSUPPORTED`, `400 CONSENT_REQUIRED` (selfie), `409 KYC_SELFIE_CHALLENGE_REQUIRED`, `409 KYC_NOT_EDITABLE`, `410 KYC_SELFIE_CHALLENGE_EXPIRED`, `413`, `422 KYC_FIELD_INVALID` (SEPREC of an individual) |
| DELETE | `/business/me/kyc/documents/:id` | | `204`, `404`, `409` |
| POST | `/business/me/kyc/submit` | → `{ submissionId, status: AUTO_APPROVED\|IN_REVIEW, reviewDueAt\|null, postReviewDueAt\|null, userFacingCodes: (PHONE_VERIFIED\|DOCUMENTS_READABLE\|DUPLICATE_NIT\|DUPLICATE_PHONE\|NAME_SIMILARITY\|MATERIAL_CHANGE)[], handle }`. Synchronous checks (≤ `KYC_PIPELINE_BUDGET_MS`) | `200`, `409 KYC_NOT_EDITABLE`, `422 KYC_INCOMPLETE {missing: (EMAIL_VERIFIED\|HANDLE\|CATEGORY\|CITY\|PHONE\|REP_FULL_NAME\|REP_CI\|LEGAL_NAME\|NIT\|ADDRESS\|LOGO\|SPECIALTY\|DOCUMENT_CI_FRONT\|DOCUMENT_CI_BACK\|DOCUMENT_SELFIE)[]}`, `429` |
| POST | `/business/me/kyc/resubmit` | → `{ submissionId, version }` (new DRAFT with the data and documents of the rejected one, without the selfie) | `201`, `409 KYC_RESUBMIT_NOT_ALLOWED {reason: NOT_REJECTED_WITH_RESUBMIT\|MAX_ATTEMPTS}`, `409 KYC_RESUBMIT_COOLDOWN {retryAt}` |
| POST | `/business/me/kyc/changes` | → `{ submissionId, version }`: material change (name, category, legal name, NIT, representative) of an approved business; never approves itself | `201`, `409 KYC_CHANGE_NOT_ALLOWED`, `409 KYC_NOT_EDITABLE`, `409 KYC_RESUBMIT_COOLDOWN` |

`Submission` = `{ id, version, purpose: INITIAL\|RESUBMISSION\|MATERIAL_CHANGE, status: DRAFT\|SUBMITTED\|AUTO_APPROVED\|IN_REVIEW\|APPROVED\|REJECTED\|SUSPENDED\|SUPERSEDED, legalKind, fields: { tradeName, primaryCategoryId, legalName, nitMasked, repFullName, repCiMasked, repCiComplement, repCiExtension, specialty, address, seprecNumber, phoneMasked }, documents: Document[], selfieChallenge: { code, instruction, expiresAt }\|null, submittedAt, decidedAt, reviewDueAt, postReviewDueAt }`.
`PATCH /business/me/profile` with a new name or category past DRAFT answers `409 BUSINESS_MATERIAL_CHANGE_REQUIRES_REVIEW` with `details.action = "POST /business/me/kyc/changes"`.
The public listing shows «Verificado por REPP» only after a human approval (`isVerified`); an automatic approval is «Nuevo».

### REPP console (`MODERATOR`, `SYSTEM_ADMIN`)

Gym staff, members and business accounts get `403`. Reading the detail and every document view write an
`admin.audit_log` row (`business/kyc-detail-view`, `business/kyc-document-view`) before answering; claims,
decisions and every account, handle, blocklist and banned-term change are audited too. Nobody reviews a
business that is their own account or uses their own mailbox: `403 MODERATION_SELF_CASE`.

| Method | Path | Body → response | Codes |
|---|---|---|---|
| GET | `/admin/business/kyc/queue` | `?queue=REVIEW\|POST_REVIEW&entityType&overdue=true\|false&cursor&limit≤100` → `{ items: [{ submissionId, accountId, entityId, entityType, tradeName, handle, version, purpose, status, submittedAt, dueAt, overdue, claimedByUserId, claimedAt, failedChecks }], nextCursor }`, oldest due first | `200`, `400` |
| GET | `/admin/business/kyc/:submissionId` | → `{ submission, identity: { nit, repCiNumber, phone } (in clear), phoneVerified, account, entity, handle, documents: [{ …Document, deleted, deleteReason, selfieChallengeCode }], checks: [{ code, outcome, detail, durationMs, createdAt }], decisions, history, claimedByUserId }`, `no-store` | `200`, `403`, `404` |
| GET | `/admin/business/kyc/:submissionId/documents/:documentId` | decrypted bytes, `Content-Type` of the photo, `Cache-Control: private, no-store`, `Content-Disposition: inline`, `nosniff` | `200`, `403`, `404` |
| POST | `/admin/business/kyc/:submissionId/claim` | → `{ claimedByUserId, claimedAt }` (30 min) | `200`, `409 KYC_CLAIMED_BY_OTHER`, `409 KYC_INVALID_TRANSITION`, `409 KYC_SUBMISSION_SUPERSEDED`, `409 BUSINESS_ACCOUNT_LOCKED` |
| POST | `/admin/business/kyc/:submissionId/release` | → `{ released: true }` | `200`, `409 KYC_NOT_CLAIMED\|KYC_CLAIMED_BY_OTHER` |
| POST | `/admin/business/kyc/:submissionId/decide` | `{ decision: APPROVE\|POST_REVIEW_OK\|REJECT, reasonCodes: (DOCUMENT_UNREADABLE\|DOCUMENT_MISMATCH\|SELFIE_MISMATCH\|GESTURE_MISMATCH\|NIT_INVALID\|LEGAL_NAME_MISMATCH\|IMPERSONATION\|DUPLICATE_ACCOUNT\|PROHIBITED_ACTIVITY\|FRAUD_SUSPECTED\|OTHER)[] (≥1 to reject), note?, allowResubmit (required to reject) }` → `{ status: APPROVED\|REJECTED, decisionId }` | `200`, `400`, `409 KYC_INVALID_TRANSITION`, `409 KYC_CLAIMED_BY_OTHER`, `409 KYC_SUBMISSION_SUPERSEDED` (not the open or current version, or a change whose approved version is gone), `409 BUSINESS_ACCOUNT_LOCKED` (suspended or closed account) |
| GET | `/admin/business/accounts` | `?search&status&entityType&cursor&limit` → `{ items: [{ accountId, email, entityId, entityType, name, handle, status, kycStatus, entityStatus, isVerified, createdAt }], nextCursor }` | `200` |
| POST | `/admin/business/accounts/:id/suspend` \| `/reinstate` | `{ reasonCode: FRAUD_SUSPECTED\|IMPERSONATION\|PAYMENT_COMPLAINTS\|PROHIBITED_ACTIVITY\|KYC_MISSING\|OTHER, note? }` → `{ status: SUSPENDED\|ACTIVE }` (in-app + email notice) | `200`, `404`, `409 KYC_INVALID_TRANSITION` |
| POST | `/admin/business/handles/reservations` | `{ handle, reason }` → `{ handle, status: RESERVED }` | `201`, `409 HANDLE_TAKEN\|HANDLE_NOT_RESERVABLE`, `422 HANDLE_INVALID` |
| DELETE | `/admin/business/handles/reservations/:handle` | | `204`, `404` |
| POST | `/admin/business/handles/:handle/force-rename` | `{ newHandle, reason }` → `{ handle, previous }` (old handle retired without redirect, locked 180 days) | `200`, `403 MODERATION_SELF_CASE`, `404`, `409 HANDLE_TAKEN`, `422 HANDLE_INVALID` |
| GET, POST | `/admin/business/blocklist` | POST `{ kind: NIT\|CI\|PHONE\|EMAIL, value, reasonCode: [A-Z0-9_], expiresAt? }` → `{ id, kind }` (only the HMAC is stored); GET → `[{ id, kind, reasonCode, createdAt, expiresAt }]` | `200`/`201`, `409 BLOCKLIST_ENTRY_EXISTS`, `422 KYC_FIELD_INVALID` |
| DELETE | `/admin/business/blocklist/:id` | | `204`, `404` |
| GET, PUT | `/admin/business/banned-terms` | PUT `{ terms: [{ term, scope: NAME\|LISTING\|BOTH }] }` replaces the list → `{ terms }` | `200`, `400` |

Metrics on `/health/metrics`: `gym_sheet_kyc_queue_size{queue}`, `gym_sheet_kyc_queue_overdue{queue}`,
`gym_sheet_kyc_queue_age_p95_seconds{queue}`, `gym_sheet_kyc_auto_approval_ratio`.

## Business listings, locations and the public marketplace (ADR-0022, franja 8c)

A **listing** is a row of `directory.entity_plans`: a plan, pass, class pack, service or product of
one business. Prices are always **BOB**. **Post-moderation**: a listing goes `LIVE` the moment the
automatic checks pass; a failing check holds it (`HELD`, not public) for REPP with the codes in
`autoCheckCodes`; REPP can later hide (`HIDDEN`) or reject (`REJECTED`) it. Public =
`moderationStatus LIVE` + `status ACTIVE` + the business `ACTIVE` (a `DRAFT`, paused, `SUSPENDED` or
`CLOSED` business takes every listing with it). Anything else is `404` on every public route,
including the legacy `/public/directory/plans*`, order creation and `POST /me/reports`.

`Listing` (own, `business/me/*`): `{ id, offerKind, name, description, benefits[], price ("250.00"),
currency: "BOB", validityDays|null, sessionsCount|null, stockQuantity|null, stockReserved,
productCategoryId|null, displayOrder, mediaUrls[], status: ACTIVE|INACTIVE|ARCHIVED, moderationStatus:
LIVE|HELD|HIDDEN|REJECTED, moderationReasonCode|null, autoCheckCodes[], visibility: PUBLIC|BUSINESS_NOT_PUBLIC|PAUSED|ARCHIVED|UNDER_REVIEW|HIDDEN_BY_REPP|REJECTED_BY_REPP, publishedAt|null, createdAt, updatedAt }`.

Fields per `offerKind` (`422 LISTING_SHAPE_INVALID {violations}` otherwise):

| `offerKind` | `validityDays` | `sessionsCount` | stock / `productCategoryId` |
| --- | --- | --- | --- |
| `MEMBERSHIP` | required | — | — |
| `DAY_PASS` | — | — | — |
| `MULTI_DAY_PASS` | required, ≥ 2 | — | — |
| `CLASS_PACK`, `SERVICE_PACK` | optional (pack expiry) | required, 1–1000 | — |
| `SERVICE_SESSION` | — | — | — |
| `PRODUCT` | — | — | optional (`null` stock = not tracked) |

Automatic checks (`autoCheckCodes`): `PRICE_OUT_OF_BAND` (outside `LISTING_PRICE_MIN_BOB`–`LISTING_PRICE_MAX_BOB`,
default 1–50 000), `PRICE_OUTLIER` (more than `LISTING_PRICE_OUTLIER_FACTOR`, default 5×, above or below
the reference price of the kind: the median of each other seller's median, one value per business and
never the seller being checked, once there are `LISTING_PRICE_MEDIAN_MIN_SELLERS` = 5 distinct sellers), `BANNED_TERMS`
(REPP's list, scope `LISTING|BOTH`). On a `LIVE` listing an edit re-checks only what changed (text or
price); a `HELD` listing re-runs everything, so fixing it publishes it. `HIDDEN`/`REJECTED` are REPP's:
while REPP holds a listing so, its content (fields, price, new photos) is frozen with `409
LISTING_LOCKED_BY_REPP {moderationStatus}`; pause, resume, archive, stock and removing a photo stay open.

| Method | Route | Body / response | Codes |
| ------ | ----- | --------------- | ----- |
| GET | `/business/me/listings` | `?status=ACTIVE\|INACTIVE\|ARCHIVED&moderationStatus&cursor&limit≤50` (archived only when asked) → `{ items: Listing[], nextCursor }`, newest first | `200`, `400 INVALID_CURSOR` |
| POST | `/business/me/listings` | `{ offerKind, name (2–180), description (5–5000), benefits?: string[≤20], price (0–10 000 000, 2 decimals), validityDays?, sessionsCount?, stockQuantity?, productCategoryId? (active, scope = business type or ALL), displayOrder? }` strict (`currency`, `moderationStatus`, `type`… → `400`) → `Listing`. Allowed while the KYC is pending (the listing waits, `BUSINESS_NOT_PUBLIC`); at most 500 not archived | `201`, `400`, `403 EMAIL_VERIFICATION_REQUIRED`, `409 BUSINESS_ACCOUNT_LOCKED`, `409 LISTING_LIMIT`, `422 LISTING_SHAPE_INVALID`, `422 LISTING_CATEGORY_INVALID` |
| GET | `/business/me/listings/:id` | → `Listing` | `200`, `404` (not yours) |
| PATCH | `/business/me/listings/:id` | any of `{ name, description, benefits, validityDays, sessionsCount, productCategoryId, displayOrder }` (the kind never changes) → `Listing` | `200`, `400`, `404`, `409 LISTING_NOT_EDITABLE` (archived), `409 LISTING_LOCKED_BY_REPP`, `409 BUSINESS_ACCOUNT_LOCKED`, `422` |
| PATCH | `/business/me/listings/:id/price` | `{ price, reason? }` → `Listing` (append-only price history) | `200`, `400 LISTING_SAME_PRICE`, `404`, `409` |
| PATCH | `/business/me/listings/:id/stock` | `{ stockQuantity: int\|null }` (products only) → `Listing` | `200`, `404`, `409 LISTING_STOCK_BELOW_RESERVED {reserved}`, `422 LISTING_SHAPE_INVALID` |
| POST | `/business/me/listings/:id/pause` \| `/resume` \| `/archive` | → `Listing`. `ACTIVE→INACTIVE`, `INACTIVE→ACTIVE`, `ACTIVE\|INACTIVE→ARCHIVED` (terminal) | `200`, `404`, `409 LISTING_INVALID_TRANSITION {status}` |
| POST | `/business/me/listings/:id/media` | multipart `file` (JPEG/PNG by bytes, ≤ `MEDIA_UPLOAD_MAX_BYTES`), ≤ 10 per listing → `Listing` | `201`, `400`, `404`, `409 LISTING_MEDIA_LIMIT`, `413` |
| DELETE | `/business/me/listings/:id/media/:position` | removes the photo at that index (file released, ADR-0017) → `Listing` | `200`, `404` |
| GET | `/business/me/locations` | → `Location[]` where `Location = { id, name, address, city, latitude, longitude, businessHours, displayOrder, createdAt, updatedAt }` | `200` |
| POST | `/business/me/locations` | `{ name (2–120), city, address?, latitude?+longitude? (both or none), businessHours?, displayOrder? }` → `Location` (≤ 50) | `201`, `400`, `409 LOCATION_NAME_TAKEN`, `409 LOCATION_LIMIT`, `409 BUSINESS_ACCOUNT_LOCKED` |
| PATCH | `/business/me/locations/:id` | any of the fields → `Location` | `200`, `400`, `404`, `409` |
| DELETE | `/business/me/locations/:id` | refused while a live SOCIO declared it (ADR-0025); closed affiliations lose the location | `204`, `404`, `409 LOCATION_IN_USE` |
| POST | `/business/me/gallery` | multipart `file` → `{ gallery: string[] }` (public profile gallery, ≤ 10) | `201`, `400`, `409 BUSINESS_GALLERY_LIMIT` |
| DELETE | `/business/me/gallery/:position` | → `{ gallery }` | `200`, `404` |

All `business/me/*` routes: `NEGOCIO` only (a person gets `403 ACCOUNT_KIND_NOT_ALLOWED`); another
business's listing or location is `404`. `GET /business/me` adds `entity.gallery`.

### Public marketplace (no token, `PUBLIC_RATE_LIMIT_MAX`)

`PublicListing`: `{ id, offerKind, name, description, benefits[], price, currency, validityDays,
sessionsCount, inStock: boolean|null, productCategory: { id, name, path }|null, mediaUrls[], publishedAt,
seller: { id, name, handle|null, entityType, logoUrl, city, badge: VERIFIED|NEW } }` — no moderation
state, stock numbers, metadata, owner or tenant.

| Method | Route | Query / response | Codes |
| ------ | ----- | ---------------- | ----- |
| GET | `/public/directory/listings` | `?q (text, or @handle)&offer_kind&entity_type&entity_id&category_path (product category, else the seller's)&city&price_min&price_max&verified_only=true&sort=recent\|price_asc\|price_desc&cursor&limit≤50` (unknown keys → `400`) → `{ items: PublicListing[], nextCursor }`, keyset-paginated | `200`, `400`, `400 INVALID_CURSOR` |
| GET | `/public/directory/listings/:id` | → `PublicListing` | `200`, `404` (not public) |
| GET | `/public/directory/profiles/:handle` | → `{ handle, entity: <public directory detail>, locations: [{ id, name, address, city, latitude, longitude, businessHours }], listings: { items, nextCursor } }` (first page, continue with `GET /public/directory/listings?entity_id=…&cursor=…`); `{ redirectTo }` for a renamed handle | `200`, `404` |

### Moderation of the marketplace

`POST /me/reports` accepts `targetKind: BUSINESS_LISTING` (listing id) and `BUSINESS_PROFILE`
(entity id) — only while public, otherwise `404`. Three distinct reporters hide a listing
automatically (pending review, like other content). In `/admin/moderation/cases/BUSINESS_LISTING|BUSINESS_PROFILE/:id`
`content` is `{ kind: BUSINESS_LISTING, name, description, benefits, offerKind, price, currency,
validityDays, sessionsCount, mediaUrls, status, moderationStatus, seller: { entityId, name, handle } }`
or `{ kind: BUSINESS_PROFILE, name, entityType, headline, description, logoUrl, coverUrl, gallery, city,
status, isVerified, handle }`. The verdict on these cases: `hideContent` (listing → `HIDDEN`; `false`
restores a hidden one: `LIVE` if its stored check codes are clean, otherwise `HELD`) and `suspendBusiness: true` (the business is suspended through its KYC state
machine in the same transaction; resolution `NEGOCIO_SUSPENDIDO`; `409 BUSINESS_ACCOUNT_REQUIRED` for a
listing REPP seeded without an account). `sanction`/`confirmMinor` there, or `suspendBusiness` on any other
kind: `422 MODERATION_RESOLUTION_NOT_APPLICABLE`. A business registered with the moderator's own mailbox
is `403 MODERATION_SELF_CASE`. The audit row adds `businessSuspended`.

| Method | Route | Access | Body / response | Codes |
| ------ | ----- | ------ | --------------- | ----- |
| GET | `/admin/business/listings` | MODERATOR, SYSTEM_ADMIN | `?moderationStatus=HELD\|HIDDEN\|REJECTED (default HELD)&cursor&limit` → `{ items: [{ id, entityId, sellerName, sellerHandle, offerKind, name, description, benefits, mediaUrls, price, currency, validityDays, sessionsCount, stockQuantity, productCategoryId, moderationStatus, moderationReasonCode, autoCheckCodes, updatedAt }], nextCursor }`, oldest first. `updatedAt` is the version stamp (ISO, microseconds, e.g. `2026-11-17T01:01:00.738123Z`): send it back unchanged to release | `200`, `403` |
| POST | `/admin/business/listings/:id/release` | MODERATOR, SYSTEM_ADMIN | `{ seenUpdatedAt (required: the item's updatedAt as listed), note? }` → `{ id, moderationStatus: LIVE }` (seller notified); audited `business/listing-release`. Edited since it was listed: nothing is published, re-read the item and decide again | `200`, `400`, `403 MODERATION_SELF_CASE`, `404`, `409 LISTING_CHANGED_SINCE_REVIEW {currentUpdatedAt}`, `409 LISTING_INVALID_TRANSITION`, `409 LISTING_NOT_PUBLISHABLE {violations}` |
| POST | `/admin/business/listings/:id/reject` | MODERATOR, SYSTEM_ADMIN | `{ reasonCode: PROHIBITED_PRODUCT\|MISLEADING\|PRICE_ABUSE\|DUPLICATE\|OTHER, note? }` → `{ id, moderationStatus: REJECTED, reasonCode }` (seller notified); audited `business/listing-reject` | `200`, `403`, `404`, `409 LISTING_INVALID_TRANSITION` |

## Directory (franja 8a fixes)

| Method | Route | Access | Notes |
| ------ | ----- | ------ | ----- |
| POST | `/directory/entities` | `SYSTEM_ADMIN` | REPP seeds a listing it owns; strict body without `is_verified`, `tenant_id` or `user_id` (`400`). Anyone else: `403` |
| GET | `/public/directory/plans`, `/public/directory/entities/:entityId/plans`, `/public/directory/plans/:planId` | public | mapped (`metadata: {}`, seller as a summary); only active, `LIVE` plans of `ACTIVE` listings (`404` otherwise; ADR-0022) |
| PATCH/DELETE | `/directory/reviews/:id` | author (delete: also `SYSTEM_ADMIN`) | someone else's review: `404` |
| POST | `/directory/entities/:id/reviews` | authenticated | `404` when the listing is not `ACTIVE` |

Removed in franja 8d (ADR-0024): `GET /public/directory/entities/:entityId/payment-config` (the payment
data is not public, D5) and every `admin/directory/*` route (payment config, plans, price, price
history, entity orders, confirm, reject; D9). Plans are edited at `business/me/listings*` (ADR-0022).

## Marketplace orders (ADR-0024, franja 8d)

The buyer pays the business directly, by its QR (`method: QR`) or in cash (`CASH`, only if the
business accepts it); **the business confirms**; REPP never touches the money and never confirms. Only
a business with a business account sells, and only what is public (`404` otherwise). Prices in `BOB`,
taken from the listing (the body carries no amount). Statuses:

```
QR:   PENDING_PAYMENT --receipt--> PENDING_VERIFICATION --confirm--> CONFIRMED
                                                        --reject---> REJECTED --receipt (≤ 3 in total)--> PENDING_VERIFICATION
CASH: PENDING_VERIFICATION --confirm--> CONFIRMED | --reject--> REJECTED
cancel (buyer): PENDING_PAYMENT, REJECTED, CASH PENDING_VERIFICATION → CANCELLED (cancelReason BUYER)
deadline (worker): PENDING_PAYMENT after ORDER_PAYMENT_TTL_HOURS (24), CASH after ORDER_CASH_TTL_HOURS (72) → EXPIRED
seller not public (worker): unpaid orders → CANCELLED (cancelReason BUSINESS_UNAVAILABLE, "no pagues")
```

A product's units are reserved when the order is created (row lock on the listing; `409 ORDER_OUT_OF_STOCK
{available}`), freed on cancel, reject or expiry, reserved again on a new receipt after a rejection, and
taken from both counters on confirm. Every change leaves a row in the append-only
`directory.payment_order_history` (the `timeline`). Notices (in-app): new cash order and receipt received
(business), confirmed, rejected with reason, expired and "no pagues" (buyer), reminders at 24 h and 48 h of
a receipt waiting (business). Since franja 8e, confirming an order opens its subscription period (see
«Subscriptions»); the legacy `dir_…` membership bridge is gone.

`Order` (both sides): `{ id, orderNumber, status, method, quantity, unitAmount, amount, currency, listing:
{ id, name, offerKind, validityDays, sessionsCount } (snapshot at purchase), seller: { entityId, name,
handle, logoUrl }, expiresAt, submittedAt, decidedAt, cancelledAt, cancelReason, rejection: { code, text,
note } | null, receipt: { uploaded, reference }, note, createdAt }`; the buyer's adds `actions: {
canUploadReceipt, canCancel, canReport }`, the business's adds `buyer: { name }` and `actions: { canDecide }`.
The detail adds `timeline: [{ status, at, reasonCode, by: BUYER|BUSINESS|SYSTEM }]`. Lists are keyset pages
`{ items, nextCursor }` (`400 INVALID_CURSOR` for a tampered cursor).

### Buyer (persons; a business account gets `403 ACCOUNT_KIND_NOT_ALLOWED`; someone else's order: `404`)

| Method | Route | Body / response | Codes |
| ------ | ----- | --------------- | ----- |
| POST | `/directory/payments/orders` | strict `{ listingId, quantity? (1; > 1 only for PRODUCT, ≤ ORDER_MAX_QUANTITY), method? QR\|CASH (QR), note? (≤ 500), affiliation? { locationId, ciLast3 (3 digits), switchGym? (false) } }` → `Order`. A **gym's `MEMBERSHIP`** needs the buyer's SOCIO at that gym: already SOCIO (confirmed or requested) buys as is; otherwise `affiliation` is required and the REQUESTED SOCIO is created in the same transaction (ADR-0025 rules; verified email) | `201`, `400` (any other field, e.g. `amount`, `planId`; `AFFILIATION_LOCATION_INVALID`), `403 EMAIL_VERIFICATION_REQUIRED` (with `affiliation`), `404` (not public / no business account), `409 SOCIO_OF_ANOTHER_GYM {affiliationId, action: SWITCH_GYM}` (retry with `switchGym: true`), `409 AFFILIATION_SOCIO_PENDING`, `409 AFFILIATION_COOLDOWN`, `409 AFFILIATION_LIMIT`, `422 AFFILIATION_REQUIRED {gymEntityId}`, `409 ORDER_OUT_OF_STOCK {available}`, `409 ORDER_ALREADY_OPEN {orderId}`, `409 ORDER_OPEN_LIMIT {max}` (ORDER_OPEN_MAX_PER_PERSON = 5), `409 ORDER_PAYMENT_METHOD_UNAVAILABLE {method}`, `422 ORDER_QUANTITY_NOT_ALLOWED {max}`, `429` (30/h) |
| GET | `/directory/payments/orders/my-orders` | `?status&cursor&limit (≤ 50)` → `{ items: Order[], nextCursor }`, newest first | `200`, `400` |
| GET | `/directory/payments/orders/:id` | `Order` + `timeline` | `200`, `404` |
| GET | `/directory/payments/orders/:id/payment-instructions` | `{ orderId, orderNumber, method, amount, currency, expiresAt, bankName, accountHolderName, accountNumber, aliasOrPhone, instructions, qrPath }` (bank fields and `qrPath` null for cash; no tax id) — open or rejected orders only | `200`, `404`, `409 ORDER_INVALID_TRANSITION`, `409 ORDER_BUSINESS_UNAVAILABLE` (seller not public: do not pay), `409 ORDER_PAYMENT_METHOD_UNAVAILABLE` |
| GET | `/directory/payments/orders/:id/payment-qr` | the business's QR image (decrypted; `Cache-Control: private, no-store`, `nosniff`) | `200`, `404`, `409` as above |
| POST | `/directory/payments/orders/:id/receipt` | multipart `file` (JPEG/PNG by bytes, ≤ `MEDIA_UPLOAD_MAX_BYTES`) + optional field `reference` (≤ 100) → `Order`. Stored encrypted at `orders/{orderId}/receipt/{uuid}.bin` (no static route serves it); the previous receipt is deleted | `200`, `400`, `404`, `409 ORDER_INVALID_TRANSITION`, `409 ORDER_RECEIPT_LIMIT {max}` (3), `409 ORDER_OUT_OF_STOCK` (resend after a rejection), `413`, `503 PAYMENT_EVIDENCE_UNAVAILABLE` |
| GET | `/directory/payments/orders/:id/receipt` | own receipt (decrypted, `no-store`) | `200`, `404` |
| POST | `/directory/payments/orders/:id/cancel` | → `Order` | `200`, `404`, `409 ORDER_INVALID_TRANSITION` |
| POST | `/me/reports` | `{ targetKind: PAYMENT_ORDER, targetId: orderId, reason, details? }` — "Tengo un problema con este pedido": only the buyer, and not while `PENDING_PAYMENT` | `201`, `404`, `409` (already reported) |

### Business (`NEGOCIO` only; persons, `MODERATOR` and `SYSTEM_ADMIN`: `403`; another business's order: `404`)

| Method | Route | Body / response | Codes |
| ------ | ----- | --------------- | ----- |
| GET | `/business/me/orders` | `?status&cursor&limit` → `{ items: Order[], nextCursor, pendingCount }`; "Por confirmar" (`PENDING_VERIFICATION`) first, oldest first, then the rest newest first | `200`, `400` |
| GET | `/business/me/orders/:id` | `Order` + `timeline` | `200`, `404` |
| GET | `/business/me/orders/:id/receipt` | the receipt (decrypted, `no-store`, `nosniff`) | `200`, `404` |
| POST | `/business/me/orders/:id/confirm` | strict `{ alsoConfirmAffiliation? (true) }` (body optional) → `Order` (`CONFIRMED`). One transaction: the order, its subscription period and, for a gym `MEMBERSHIP`, the buyer's REQUESTED SOCIO at this gym (unless `alsoConfirmAffiliation: false` — «también confirmo que es socio»); if one fails nothing changes. Row-locked: of two at once one is `200`, the other `409`; a replay is `409` | `200`, `400`, `404`, `409 ORDER_INVALID_TRANSITION`, `409 GYM_NOT_ACTIVE` (a gym REPP suspended confirms the payment only with `alsoConfirmAffiliation: false`) |
| POST | `/business/me/orders/:id/reject` | strict `{ reasonCode: AMOUNT_MISMATCH\|UNREADABLE\|NOT_RECEIVED\|OTHER, note? (3–500; required with OTHER) }` → `Order` (`REJECTED`) | `200`, `400`, `404`, `409 ORDER_INVALID_TRANSITION`, `422 ORDER_REJECTION_NOTE_REQUIRED` |
| GET | `/business/me/payment-config` | `{ bankName, accountHolderName, accountNumber, aliasOrPhone, instructions, acceptsCash, isActive, hasQr, holderMatch: PASS\|WARN\|UNKNOWN, updatedAt } \| null` | `200` |
| PUT | `/business/me/payment-config` | strict `{ bankName, accountHolderName, accountNumber?, aliasOrPhone?, instructions?, acceptsCash? (false), isActive? (true) }` → same. A holder whose trigram similarity with the KYC legal name or representative is under 0.6 is `WARN` and flags REPP's post-review (`kyc_checks PAYMENT_HOLDER_MATCH`); it never blocks | `200`, `400`, `409 BUSINESS_ACCOUNT_LOCKED` |
| PUT | `/business/me/payment-config/qr` | multipart `file` (JPEG/PNG) → same; encrypted at `business/{entityId}/payment/{uuid}.bin`, never public; the previous QR is deleted | `200`, `400`, `409 PAYMENT_CONFIG_REQUIRED`, `409 BUSINESS_ACCOUNT_LOCKED`, `413`, `503 PAYMENT_EVIDENCE_UNAVAILABLE` |
| GET | `/business/me/payment-config/qr` | own QR image | `200`, `404` |

A suspended business still decides the orders already paid (`PENDING_VERIFICATION`); its unpaid orders are
cancelled by the worker and its payment data is no longer handed out.

### REPP (`MODERATOR`, `SYSTEM_ADMIN`): disputes only

`/admin/moderation/cases/PAYMENT_ORDER/:orderId` is a regular case (reported account: the business).
`content` is `{ kind: PAYMENT_ORDER, orderNumber, status, method, quantity, unitAmount, amount, currency,
listingName, buyerNote, receipt: { uploaded, sha256, reference, attempts, path }, rejection, cancelReason,
createdAt, submittedAt, decidedAt, seller: { entityId, name, handle, status, isVerified, holderMatch },
timeline }`. The verdict may `suspendBusiness` (no person ladder: `422`); an order is never hidden and
REPP refunds nothing.

| Method | Route | Response | Codes |
| ------ | ----- | -------- | ----- |
| GET | `/admin/moderation/cases/PAYMENT_ORDER/:orderId/receipt` | the receipt, only while a `PAYMENT_ORDER` case exists for it and the moderator may read the case (ADR-0018 §8); audited `moderation/payment-order-receipt-view` before the bytes go out | `200`, `403`, `404` |

`GET /health/metrics` adds `gym_sheet_orders_undecided`, `gym_sheet_orders_undecided_overdue` (past the
second reminder) and `gym_sheet_orders_undecided_oldest_seconds`.

## Affiliations to a gym (ADR-0025, franja 7b)

A person is SOCIO of one gym and ENTRENADOR of several; a coach business (entity `COACH`) links to gyms
by `@handle`. The gym (business account with a `GYM` entity) confirms, rejects or ends. The gym is named
by its directory entity, never by `usuarios.tenant_id`. Only a public gym (`ACTIVE`) receives requests;
any other is `404`.

`Affiliation` (what the person or coach reads) = `{ id, kind: SOCIO|ENTRENADOR, status:
REQUESTED|CONFIRMED|REJECTED|ENDED|CANCELLED, gym: { id, name, handle, logoUrl }, location: { id, name } |
null, ciLast3 (persons; null for a coach), replacesAffiliationId, reasonCode, reasonNote, requestedAt,
confirmedAt, closedAt }`. Reason codes: gym rejection `UNKNOWN_PERSON|CI_MISMATCH|WRONG_LOCATION|
NOT_A_COACH_HERE|OTHER`; gym end `NO_LONGER_MEMBER|NO_LONGER_COACH|CONDUCT|OTHER`; subject `WITHDRAWN`
(cancel), `LEFT` (end); system `SWITCHED_GYM`, `ACCOUNT_CLOSED`.

### Person (`me/affiliations`; a business account gets `403 ACCOUNT_KIND_NOT_ALLOWED`; someone else's: `404`)

| Method | Route | Body / response | Codes |
| ------ | ----- | --------------- | ----- |
| POST | `/me/affiliations` | strict `{ gymHandle \| gymEntityId (exactly one), kind, locationId (required for SOCIO, a location of that gym), ciLast3 (3 digits), switchGym? (false) }` → `Affiliation` (`REQUESTED`). Verified email; 20/hour | `201`, `400`, `400 AFFILIATION_LOCATION_INVALID`, `403 EMAIL_VERIFICATION_REQUIRED`, `404`, `409 AFFILIATION_ALREADY_LIVE {affiliationId,status}`, `409 AFFILIATION_SOCIO_PENDING {affiliationId}`, `409 SOCIO_OF_ANOTHER_GYM {affiliationId, action: SWITCH_GYM}`, `409 AFFILIATION_LIMIT {max: 5}`, `409 AFFILIATION_COOLDOWN {retryAfter}`, `429` |
| GET | `/me/affiliations` | `?cursor&limit` → `{ items: Affiliation[], nextCursor }`, newest first | `200`, `400` |
| GET | `/me/affiliations/:id` | `Affiliation` | `200`, `404` |
| POST | `/me/affiliations/:id/cancel` | `REQUESTED` → `CANCELLED` (`WITHDRAWN`) | `200`, `404`, `409 AFFILIATION_INVALID_TRANSITION` |
| POST | `/me/affiliations/:id/end` | `CONFIRMED` → `ENDED` (`LEFT`) | `200`, `404`, `409 AFFILIATION_INVALID_TRANSITION` |

«Cambio de gimnasio»: with a confirmed SOCIO elsewhere, a SOCIO request is `409 SOCIO_OF_ANOTHER_GYM`
unless `switchGym: true`; then it is created with `replacesAffiliationId` and the old one ends
(`SWITCHED_GYM`) only when the new gym confirms, in the same transaction. One pending SOCIO request at a
time. After the gym rejects or ends, the same gym and kind wait 7 days; after a cancellation, 1 day.

### Coach business (`business/me/gym-links`; `NEGOCIO` with a `COACH` entity, else `403 BUSINESS_TYPE_NOT_ALLOWED`)

| Method | Route | Body / response | Codes |
| ------ | ----- | --------------- | ----- |
| POST | `/business/me/gym-links` | strict `{ gymHandle \| gymEntityId, locationId? }` → `Affiliation` (`ENTRENADOR`, `REQUESTED`). The coach's own profile must be public | `201`, `400`, `403`, `404`, `409 COACH_NOT_PUBLIC`, `409 AFFILIATION_ALREADY_LIVE`, `409 AFFILIATION_LIMIT {max: 10}`, `409 AFFILIATION_COOLDOWN` |
| GET | `/business/me/gym-links` | `?cursor&limit` → `{ items, nextCursor }` | `200`, `403` |
| GET | `/business/me/gym-links/:id` | `Affiliation` | `200`, `403`, `404` |
| POST | `/business/me/gym-links/:id/cancel` | `REQUESTED` → `CANCELLED` | `200`, `403`, `404`, `409` |
| POST | `/business/me/gym-links/:id/end` | `CONFIRMED` → `ENDED` | `200`, `403`, `404`, `409` |

### Gym (`business/me/affiliations`; `NEGOCIO` with a `GYM` entity, else `403 BUSINESS_TYPE_NOT_ALLOWED`; another gym's: `404`)

`GymAffiliation` = `{ id, kind, status, subject, location: { id, name } | null, requestedAt, confirmedAt }`;
`subject` = `{ type: PERSON, displayName, photoUrl, ciLast3 }` or `{ type: BUSINESS, name, handle, logoUrl,
badge: VERIFIED|NEW }`, and `null` on a closed row (the echo of `reject` and `end`). Nothing else about a
person (no id, email, age, social profile or full CI). A closed row (REJECTED, CANCELLED, ENDED) is `404` by
id and never listed; its CI digits are erased (also in the person's own view).
Pending requests are read and decided only while the gym is public: otherwise `409 GYM_NOT_ACTIVE` (and a
pending one is `404` by id); members, coaches and `end` keep working.

| Method | Route | Body / response | Codes |
| ------ | ----- | --------------- | ----- |
| GET | `/business/me/affiliations/requests` | `?kind&locationId&cursor&limit` → `{ items: GymAffiliation[], nextCursor, pendingCount }`, oldest first | `200`, `400`, `403`, `409 GYM_NOT_ACTIVE` |
| GET | `/business/me/affiliations/members` | `?locationId&cursor&limit` → confirmed SOCIO, newest first | `200`, `400`, `403` |
| GET | `/business/me/affiliations/coaches` | `?cursor&limit` → confirmed ENTRENADOR (persons and coach businesses) | `200`, `400`, `403` |
| GET | `/business/me/affiliations/:id` | `GymAffiliation` of a live row: a member or coach, or a request while the gym is public | `200`, `403`, `404` (another gym's, closed, or pending with the gym not public) |
| POST | `/business/me/affiliations/:id/confirm` | `REQUESTED` → `CONFIRMED`; a gym switch ends the person's SOCIO elsewhere in the same transaction. Of two at once, one is `200` and the other `409` | `200`, `403`, `404`, `409 AFFILIATION_INVALID_TRANSITION`, `409 GYM_NOT_ACTIVE`, `409 SOCIO_OF_ANOTHER_GYM` |
| POST | `/business/me/affiliations/:id/reject` | strict `{ reasonCode (rejection chips), note? (3–500; required with OTHER) }` → `GymAffiliation` with `subject: null` | `200`, `400`, `403`, `404`, `409`, `422 AFFILIATION_NOTE_REQUIRED` |
| POST | `/business/me/affiliations/:id/end` | strict `{ reasonCode (end chips), note? }`: `CONFIRMED` → `ENDED`, → `GymAffiliation` with `subject: null` | `200`, `400`, `403`, `404`, `409`, `422 AFFILIATION_NOTE_REQUIRED` |

Notices (in-app, key `affiliation:{id}:{event}`): `requested` to the gym (it never names the person);
`confirmed`, `rejected`, `ended` to the person or the coach. To report a gym's handling, use
`POST /me/reports` with `targetKind: BUSINESS_PROFILE` and the gym's entity id.

## Gym community by confirmed affiliation (ADR-0027, franja 7c)

The gym of a person is their single **CONFIRMED SOCIO** affiliation (`directory.affiliations`), never
`usuarios.tenant_id`, which stays as installation/brand. No gym id is ever taken from the client: every
gym-scoped route reads the viewer's own confirmed gym, so another gym's community cannot be addressed.
Without a confirmed SOCIO those routes answer `403 GYM_MEMBERSHIP_REQUIRED { status: NONE | REQUESTED }`
(the same tenant grants nothing). Persons only: a business account gets `403 ACCOUNT_KIND_NOT_ALLOWED`.

`MyGym` = `{ status: NONE|REQUESTED|CONFIRMED, gym: { id, name, handle, logoUrl } | null (CONFIRMED only),
location: { id, name } | null, since (confirmedAt) | null, affiliationId | null, pendingRequest: {
affiliationId, gym, location, requestedAt, switchesGym } | null, membershipVisible }`. `REQUESTED` is the
«Solicitud enviada» card (`gym: null`, the request in `pendingRequest`); a gym switch shows `CONFIRMED`
with `pendingRequest.switchesGym: true` until the new gym confirms.

| Method | Route | Body / response | Codes |
| ------ | ----- | --------------- | ----- |
| GET | `/me/gym` | `MyGym` (`Cache-Control: private, no-store`) | `200`, `403 ACCOUNT_KIND_NOT_ALLOWED` |
| PUT | `/me/gym/visibility` | strict `{ membershipVisible: boolean }` → `MyGym` | `200`, `400`, `403` |
| GET | `/me/gym/members` | `?q&limit (1–50, 20)` → `DirectoryEntry[]` of the gym's confirmed SOCIOs who show their membership and have their social profile on, by name; verified email | `200`, `400`, `403 GYM_MEMBERSHIP_REQUIRED`, `403 EMAIL_VERIFICATION_REQUIRED` |
| GET | `/me/progression/leaderboard` | `?limit (1–50, 10)&sortBy (points\|streak)` → `[{ position, userId, points, levelCode, streakDays, displayName, photoUrl, badges, isMe }]`: the confirmed SOCIOs of the viewer's gym with points; whoever hides the membership is left out (except for themselves); a block hides the photo | `200`, `403 GYM_MEMBERSHIP_REQUIRED` |

**«Socio de X».** Every directory card (`/me/gym-directory`, `/me/gym-directory/:userId`, the Conocer deck,
likes and passes, map people, `/me/gym/members`) carries `gymBadge: { id, name, handle, logoUrl } | null`:
set only for a CONFIRMED SOCIO of a public (`ACTIVE`) gym whose member has the social profile on and
`membershipVisible`. It is computed from the database on every read; no input sets it.

**Conocer.** Reason `SAME_GYM` and an affinity signal when the viewer and the candidate are CONFIRMED SOCIOs
of the same gym (candidate showing it). The confirmed members of the viewer's gym enter the candidate pool
and are inside the perimeter whatever their tenant (also for like/connect); the rest of the perimeter is
unchanged (tenant + bilateral cross-gym consent).

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

The primary OpenAPI contract is maintained at `docs/endpoints/openapi.yaml` and covers the full client and administrative surface (auth, profile, onboarding, equipment, exercises, media, favorites, workouts, export, dataset import, subscriptions, facilities, notifications and routines). The observability endpoints introduced by hardening are isolated in `docs/endpoints/openapi-observability.yaml` so infrastructure teams can import only the operational surface. The Postman collection currently covers the core client and catalog flows (health, auth, profile, equipment, exercises, media, favorites, workouts, export) and does **not** yet mirror the full route inventory; onboarding, subscriptions, facilities, notifications and routines are pending.

Controller, schema, route, response, error, or limit changes must update OpenAPI, this endpoint guide and the Postman collection in the same pull request.
