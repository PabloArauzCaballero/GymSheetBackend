# Exercises module

## Responsibilities

This module manages:

- administrator-owned global exercises;
- user-owned personal exercises;
- visibility and object-level authorization;
- exercise-to-equipment relations;
- favorite exercise selections;
- structured instructional data;
- exercise image, GIF, and video metadata;
- imports from source-specific connectors.

## Visibility and ownership

```txt
GLOBAL + ACTIVE
→ visible to authenticated users
→ writable only by ADMIN

PERSONAL + ACTIVE
→ visible only to createdByUserId
→ writable only by createdByUserId
```

All identifier routes validate UUID format before querying PostgreSQL. Services re-check visibility and ownership; controllers do not trust IDs supplied by clients.

## API contract versus internal names

The existing v1 HTTP contract retains Spanish field names where changing them would break consumers. Zod transforms those inputs to English application identifiers. ORM models use English properties and map them to the legacy PostgreSQL columns with Sequelize `field` declarations.

Example:

```txt
HTTP nombre
→ application name
→ database nombre
```

Responses are created by explicit mappers and never expose Sequelize model instances directly.

## Pagination

Exercise lists require bounded pagination:

```txt
page >= 1
1 <= pageSize <= 100
```

Filtering supports search text, muscle group, equipment, body part, target muscle, and data source. Sorting is server-defined rather than caller-controlled.

## Exercise media

Media is stored in `training.exercise_media`. PostgreSQL stores references and metadata, not large binaries. Each active exercise can have up to ten active media records through the synchronous API and at most one active primary record.

Media creation requires:

- HTTPS URL;
- explicit media type and provider;
- useful alternative text;
- bounded metadata;
- valid dimensions and SHA-256 format when supplied;
- ownership of a personal exercise or administrator role for a global exercise.

See `docs/architecture/exercise-data-and-media.md`.

## External imports

Source-specific code lives under `import/`. Imported records are isolated by `dataSource` and `externalId`; custom exercises continue to be created normally and are not overwritten.

See `import/README.md` for the `hasaneyldrm/exercises-dataset` connector.

## Transactions and integrity

Exercise creation and equipment-link replacement run in a transaction. Equipment identifiers are validated before destructive replacement. Database constraints remain the final authority for uniqueness and foreign-key integrity.

## Safety boundary

Exercise instructions are educational catalog content. This module does not diagnose conditions, prescribe rehabilitation, determine medical readiness, or guarantee that an exercise is appropriate for every person.
