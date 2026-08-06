---
title: "Resumen ejecutivo"
type: overview
status: verified
owner: unknown
criticality: high
last_reviewed: "2026-08-06"
source_revision: "27f3fd2"
tags: [backend, documentation, overview]
related: ["[[02-architecture/architecture-overview]]"]
---

# Resumen ejecutivo

## Propósito

Backend de gestión integral de un gimnasio: control de **membresías** (planes, renovaciones, entitlements), **acceso físico** (credenciales, dispositivos biométricos, decisiones de acceso), **entrenamiento** (rutinas, ejercicios, sesiones), **perfiles** de cliente (onboarding, antropometría, medidas corporales) y **notificaciones** (recordatorios de vencimiento vía WhatsApp).

## Consumidores

- Aplicación móvil/web de clientes y staff (API REST autenticada por JWT).
- Dispositivos de acceso físico (a través del adaptador de acceso; ver [[02-architecture/trust-boundaries]] y ADR-0002).
- Scraper de métricas Prometheus (`/health/metrics`, protegido por token).

## Capacidades principales

| Capacidad | Módulo | Nota |
|---|---|---|
| Autenticación JWT (access+refresh) | `auth` | [[03-domains/auth/index]] |
| Membresías, planes, entitlements | `membership` | [[03-domains/membership/index]] |
| Control de acceso físico y biometría | `access-control` | [[03-domains/access-control/index]] |
| Rutinas y sesiones de entrenamiento | `training`, `workouts` | [[03-domains/training/index]] |
| Catálogo de ejercicios y media | `exercises` | [[03-domains/exercises/index]] |
| Perfiles, onboarding, antropometría | `profiles` | [[03-domains/profiles/index]] |
| Notificaciones y recordatorios | `notifications` | [[03-domains/notifications/index]] |
| Mensajería transaccional (outbox) | `integration` | [[07-async-processing/events]] |

## Arquitectura resumida

Monolito modular NestJS + **workers** de background que consumen un **outbox transaccional** (ADR-0005). PostgreSQL 16 como almacén principal; Redis opcional para rate limiting compartido en multi-instancia. Ver [[02-architecture/architecture-overview]].

## Datos críticos

Membresías y entitlements, credenciales de acceso, eventos de dispositivos, datos personales de perfil/antropometría (PII). Ver [[05-data/sensitive-data]].

## Integraciones críticas

- Gateway de notificaciones externo (WhatsApp) con allowlist SSRF.
- Dataset externo de ejercicios (import con allowlist y límites de tamaño).

## Riesgos principales

Ver `BACKEND_AUDIT_HARDENING_AND_ACTION_PLAN.md` y [[14-audits/risks-register]].

## Limitaciones conocidas de esta documentación

- Generada por análisis estático; no se ejecutó el sistema como parte de este bootstrap.
- Cardinalidades y borrados (`ON DELETE`) verificados contra `schema.sql`/migraciones; ver marcas `INFERIDO` donde falte evidencia directa.

## Próximos pasos

Completar catálogos de endpoints por grupo y runbooks operativos; ver [[_meta/unresolved-items]].
