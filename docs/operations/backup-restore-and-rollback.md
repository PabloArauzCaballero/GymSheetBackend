# Backup, restore and rollback procedure

## Goal

Prove that a release can be recovered, not merely that a backup command completes. The CI workflow performs a disposable `pg_dump`/`pg_restore` rehearsal and verifies the hardening migration in both directions.

Production execution still requires approved credentials, storage, retention and recovery objectives from the operator.

## Preconditions

- PostgreSQL client tools must match or be compatible with the server version.
- The migration role and backup role must be separate from the normal runtime role.
- A restore target must be isolated from production traffic.
- Secrets must come from the deployment secret manager, never from committed files or command history.
- The operator must record the application commit, migration metadata and backup checksum.

## Backup

Use a custom-format backup so restore can fail fast and preserve object metadata:

```bash
pg_dump \
  --host "$DB_HOST" \
  --port "$DB_PORT" \
  --username "$BACKUP_DB_USER" \
  --dbname "$DB_NAME" \
  --format custom \
  --file "gym-sheet-$(date -u +%Y%m%dT%H%M%SZ).dump"
```

Store the file in encrypted, access-controlled storage and record its SHA-256 checksum. Do not place database credentials in the command line.

## Restore rehearsal

Restore into a new disposable database:

```bash
createdb \
  --host "$RESTORE_DB_HOST" \
  --port "$RESTORE_DB_PORT" \
  --username "$RESTORE_DB_ADMIN_USER" \
  gym_sheet_restore

pg_restore \
  --host "$RESTORE_DB_HOST" \
  --port "$RESTORE_DB_PORT" \
  --username "$RESTORE_DB_ADMIN_USER" \
  --dbname gym_sheet_restore \
  --exit-on-error \
  gym-sheet-backup.dump
```

Verify at minimum:

- expected schemas and tables exist;
- `app_meta.schema_migrations` matches the release;
- representative row counts and relationships are intact;
- constraints and critical indexes exist;
- the application can pass readiness against the restored database;
- authentication and one owned workout read can be exercised with synthetic staging data.

## Application and migration rollback

1. Stop new deployment traffic.
2. Confirm whether the migration is backward compatible with the previous application version.
3. If safe, deploy the previous application image before reversing the migration.
4. Run:

```bash
yarn migration:down:prod
```

5. Verify migration metadata and the expected removed objects.
6. Run readiness and the critical smoke tests.
7. Restore traffic gradually.

Never run `migration:down` blindly when newer writes may depend on the new schema. If rollback would destroy required data, restore from the verified backup or deploy a forward-fix migration instead.

## Evidence record

For every rehearsal or incident, record:

- timestamp and operator;
- source environment and commit SHA;
- PostgreSQL version;
- backup size and checksum;
- backup duration;
- restore duration;
- migration up/down duration;
- verification queries and results;
- application smoke-test result;
- deviations and corrective actions.

## CI scope

The hardening workflow creates representative baseline rows, applies the migration, rolls it back, reapplies it, verifies data preservation, restores a custom-format dump into a new database and repeats rollback/reapply there. This catches migration and backup regressions, but does not replace a rehearsal with production-like volume and deployment permissions.
