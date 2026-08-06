---
title: "Seguridad de dependencias"
type: security
status: verified
criticality: medium
last_reviewed: "2026-08-06"
source_revision: "27f3fd2"
source_files:
  - "package.json"
  - "docs/decisions/ADR-0003-remove-unused-dependencies.md"
  - "docs/decisions/ADR-0004-brace-expansion-security-resolution.md"
tags: [backend, security, dependencies, supply-chain]
---

# Seguridad de dependencias

> Defensivo. Gestión de cadena de suministro y auditoría de dependencias.

## Controles (VERIFICADO)

- **Auditoría de producción**: `yarn audit:prod` audita solo dependencias de producción
  (comando real en `package.json`, ver [[15-reference/commands]]).
- **Gestor único**: `yarn` con lockfile (`yarn install --frozen-lockfile`). No mezclar npm/pnpm
  (regla `70-library-selection.md`).
- **Política de librerías**: prohibido añadir dos librerías para la misma responsabilidad sin ADR;
  eliminar dependencias no usadas (regla `70-library-selection.md`).

## Decisiones registradas (ADR)

- **ADR-0001** — actualización de seguridad a NestJS 11 (`docs/decisions/ADR-0001-...`).
- **ADR-0003** — eliminación de dependencias no usadas para reducir superficie
  (`docs/decisions/ADR-0003-remove-unused-dependencies.md`).
- **ADR-0004** — resolución de la vulnerabilidad de `brace-expansion` mediante `resolutions`
  (`docs/decisions/ADR-0004-brace-expansion-security-resolution.md`).

## Cambios mayores

Cambios de versión mayor del stack o de dependencias requieren ADR en `docs/decisions/`
(regla `00-governance.md`).

## Brechas / advertencias

- No se observa en el código revisado un pipeline automatizado de SCA que **bloquee** el merge ante
  vulnerabilidades nuevas; `audit:prod` existe como comando pero su ejecución en CI debe verificarse
  (INFERIDO). Ver `BACKEND_AUDIT_HARDENING_AND_ACTION_PLAN.md`.

Relacionado: [[08-security/security-overview]] · [[10-operations/observability-and-alerts]].
