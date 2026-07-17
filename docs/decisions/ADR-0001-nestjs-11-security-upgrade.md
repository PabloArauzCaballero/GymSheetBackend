# ADR-0001: Upgrade the NestJS runtime to the supported 11.x line

- Status: accepted
- Date: 2026-07-17
- Decision owners: backend maintainers
- Scope: `HARDENING`

## Context

The production dependency audit identified high-severity denial-of-service advisories in the Multer version pulled by the previous NestJS 10 platform package, plus advisories in transitive `lodash`, `file-type`, `qs`, `uuid`, and NestJS core.

The patched NestJS core release is in the 11.x line. Remaining on 10.x would require increasingly fragile transitive overrides while leaving the framework itself below the patched core version.

## Decision

Upgrade the coordinated NestJS packages to compatible stable releases:

```txt
@nestjs/common           11.1.28
@nestjs/core             11.1.28
@nestjs/platform-express 11.1.28
@nestjs/testing          11.1.28
@nestjs/config           4.0.4
@nestjs/jwt              11.0.2
@nestjs/passport         11.0.5
@nestjs/sequelize        11.0.1
@nestjs/throttler        6.5.0
```

Keep the existing Express adapter because the application already uses Express request/response types and body parsers, and no representative benchmark demonstrated that an adapter migration would justify the additional production risk.

Keep Sequelize 6 on its latest stable 6.x release. Sequelize 7 remains alpha and is not accepted for this production hardening branch.

Use Yarn’s selective resolution only for the vulnerable transitive `uuid` package still requested by Sequelize 6. The resolution is validated by type-check, unit tests, build, migration rehearsal and HTTP smoke tests.

## Consequences

Positive:

- framework core and bundled Express platform dependencies receive current security fixes;
- all NestJS packages use the same major version;
- the application stays on a supported Node.js range;
- no HTTP adapter or ORM rewrite is introduced.

Costs and risks:

- this is a major framework upgrade and can expose changed types or lifecycle behavior;
- the lockfile must be regenerated and reviewed;
- all CI gates must pass after the lockfile update;
- the `uuid` resolution must remain covered by the regression suite until Sequelize removes the older transitive requirement.

## Verification gates

The decision is accepted only when the upgraded lockfile passes:

1. frozen Yarn installation;
2. production dependency audit with no critical or high vulnerabilities;
3. strict TypeScript check;
4. unit tests;
5. production build;
6. migration up/down/reapply and data preservation;
7. backup restore rehearsal;
8. HTTP latency, memory and abuse smoke tests.

## Rollback

If the upgrade fails a gate and cannot be corrected safely, revert `package.json` and `yarn.lock` together to the last green commit. Do not downgrade individual NestJS packages independently because mixed framework majors are unsupported and difficult to reason about.
