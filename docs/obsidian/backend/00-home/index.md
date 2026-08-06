---
title: "GymSheet Backend — Knowledge Base"
type: overview
status: verified
owner: unknown
criticality: high
last_reviewed: "2026-08-06"
source_revision: "27f3fd2"
tags:
  - backend
  - documentation
  - home
aliases: [Home, Inicio]
related: []
---

# GymSheet Backend — Base de Conocimiento

Backend NestJS de gestión de gimnasio: entrenamientos, ejercicios, membresías, control de acceso físico/biometría y notificaciones. **No** es plataforma de inteligencia económica ni tiene ingesta por agentes de IA.

## Empezar aquí

- [[00-home/executive-summary|Resumen ejecutivo]]
- [[00-home/quick-start|Quick start]]
- [[00-home/navigation-map|Mapa de navegación]]
- [[02-architecture/architecture-overview|Arquitectura]]
- [[03-domains/index|Dominios y módulos]]
- [[04-api/index|API]]
- [[05-data/data-architecture|Arquitectura de datos]]
- [[08-security/security-overview|Seguridad]]
- [[09-observability/observability-overview|Observabilidad]]
- [[10-operations/deployment|Despliegue]]
- [[10-operations/runbooks/index|Runbooks]]
- [[14-audits/risks-register|Registro de riesgos]]

## Estado documental

- Modo: `bootstrap`. Cobertura estimada: ver [[14-audits/documentation-coverage]].
- Fuentes de verdad: código en `src/`, `docs/db/schema.sql`, `docs/endpoints/openapi.yaml`, ADRs.

## Componentes críticos

- API HTTP · Workers de polling · Outbox transaccional · PostgreSQL 16 · Redis (rate limiting).

## Riesgos principales

Ver [[14-audits/risks-register]] y `BACKEND_AUDIT_HARDENING_AND_ACTION_PLAN.md`.

## Pendientes

Ver [[_meta/unresolved-items]].
