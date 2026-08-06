---
title: "Catálogo de dominios"
type: domain-index
status: verified
criticality: medium
last_reviewed: "2026-08-06"
source_revision: "27f3fd2"
tags: [backend, domain, index]
related: []
---

# Catálogo de dominios

15 módulos de dominio bajo `src/modules/`. Guards globales (`ThrottlerGuard`,
`JwtAuthGuard`, `RolesGuard`) registrados en `src/app.module.ts` como `APP_GUARD`; cada
controlador afina con `@Roles`/`@Public`. Validación de entrada con Zod, mapeo con `*.mapper.ts`.

| Módulo | Criticidad | Responsabilidad (una línea) |
|---|---|---|
| [[03-domains/membership/index\|Membership]] | high | Planes, membresías, intents de renovación/extensión, entitlements, clientes y staff con scopes. |
| [[03-domains/access-control/index\|Access-control]] | high | Credenciales, dispositivos, cola de eventos y decisiones de acceso físico (boundary PACS, ADR-0002). |
| [[03-domains/training/index\|Training]] | high | Rutinas, ejercicios de rutina y asignaciones coach→cliente; inicia sesiones de entrenamiento. |
| [[03-domains/workouts/index\|Workouts]] | medium | Sesiones de entrenamiento en vivo, ejercicios de sesión y sets (self-service por propiedad). |
| [[03-domains/integration/index\|Integration]] | high | Outbox transaccional, log de domain events, métricas/retención de cola, import legacy (ADR-0005). |
| [[03-domains/notifications/index\|Notifications]] | medium | Preferencias, mensajes in-app, recordatorios de membresía y entrega vía gateway HTTP firmado. |
| [[03-domains/auth/index\|Auth]] | high | Registro y login JWT HS256, hashing bcrypt, anti-enumeración, revalidación del principal. |
| [[03-domains/users/index\|Users]] | low | Modelo de usuario y lectura del usuario actual (`/users/me`); repositorio reusado por otros módulos. |
| [[03-domains/profiles/index\|Profiles]] | medium | Onboarding por pasos, medidas corporales y proyección antropométrica del usuario. |
| [[03-domains/exercises/index\|Exercises]] | medium | Catálogo global/personal de ejercicios, media, favoritos y sync de dataset externo (SSRF allowlist). |
| [[03-domains/equipment/index\|Equipment]] | low | Catálogo de equipamiento del gimnasio (activos), administrado por ADMIN. |
| [[03-domains/facilities/index\|Facilities]] | medium | Sucursales, salas, puntos de acceso, asignación de equipos y eventos de mantenimiento. |
| [[03-domains/health/index\|Health]] | medium | Liveness/readiness (Postgres, migraciones, Redis) y métricas Prometheus protegidas. |
| [[03-domains/export/index\|Export]] | low | Exportación síncrona acotada del historial de entrenamiento (JSON/CSV) con tope de tamaño. |
| [[03-domains/notifications/index\|Notifications (delivery)]] | medium | Adaptadores de entrega (in-app, gateway HTTP, mock) seleccionados por factory. |

> Nota: el catálogo lista 15 dominios; Notifications aparece una vez como módulo (la fila de
> "delivery" resalta su subsistema de adaptadores). Módulos núcleo con mayor profundidad:
> **Membership**, **Access-control**, **Training**.

## Cortes transversales

- Contratos HTTP: [[04-api/index]].
- Datos y esquema físico: [[05-data/index]].
- Procesamiento asíncrono y workers: [[07-async-processing/workers]].
- Mapa del repositorio: [[01-overview/repository-map]].

## Riesgos transversales detectados

- `ARCH-1` — Varios módulos (membership, facilities) usan `DomainEventPublisher.record` (solo
  persiste el evento) en lugar de `recordAndEnqueue`; sus eventos **no** se encolan al outbox.
- `ARCH-2` — Inconsistencia 403 vs 404 en acceso ajeno: training/exercises devuelven 403 en
  algunos casos; workouts/membership devuelven 404 (regla del repo: 404).
- `DATA-1` — Equipment/Facilities crean registros con columnas únicas sin traducir
  `UniqueConstraintError` a 409 (posible 500).
- `SEC-1` — `/health/metrics` queda abierto si `METRICS_SCRAPE_TOKEN` no está configurado.
