---
title: "Estrategia de pruebas"
type: reference
status: verified
criticality: medium
last_reviewed: "2026-08-06"
source_revision: "27f3fd2"
source_files: ["test/", "src/**/*.spec.ts", "test/jest-e2e.json", ".github/workflows/hardening-ci.yml"]
tags: [backend, quality, testing]
---

# Estrategia de pruebas

## Inventario (VERIFICADO, rev 27f3fd2)

| Tipo | Cantidad | Ubicación | Comando |
|---|---:|---|---|
| Unitarias | 34 specs | `src/**/*.spec.ts` | `yarn test` (`jest --runInBand`) |
| E2E | 2 specs | `test/*.e2e-spec.ts` | `yarn test:e2e` (PostgreSQL `:5433`) |
| Carga (smoke) | 1 | `test/load/http-load-smoke.mjs` | manual (con presupuesto) |

### E2E existentes

- `test/auth-and-authorization.e2e-spec.ts` — autenticación y autorización.
- `test/workout-ownership.e2e-spec.ts` — propiedad por recurso (acceso ajeno → 404).

## Quality gates

- `yarn lint` (ESLint 9 flat, type-aware) · `yarn type-check` (`tsc --noEmit`) · `yarn test` · `yarn test:e2e` · `yarn build`.
- CI: `.github/workflows/hardening-ci.yml`.

> [!warning] Los gates no bastan
> Cuatro defectos graves (F-012/F-014/F-015/F-016, ver `BACKEND_AUDIT_HARDENING_AND_ACTION_PLAN.md`) fueron invisibles a lint/type-check/test y solo aparecieron al ejecutar y romper el sistema. Regla del proyecto: **no declarar éxito sin evidencia ejecutada** (ver skill `production-verification`).

## Gaps (INFERIDO)

- Solo 2 flujos con cobertura E2E (auth, ownership); membership/access-control/outbox sin E2E dedicado.
- Sin pruebas de contrato del OpenAPI ni de idempotencia del outbox verificadas aquí.

Ver [[11-quality/coverage-gaps]] · [[14-audits/technical-debt]].
