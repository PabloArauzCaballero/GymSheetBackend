---
title: "Componentes"
type: architecture
status: verified
last_reviewed: "2026-08-06"
source_revision: "27f3fd2"
tags: [backend, architecture]
---

# Componentes

Componentes internos de la API y su rol por capa. Vista C4: [[02-architecture/views/c4-component]].
Módulos de dominio en detalle: [[03-domains/index]].

## Transversales (`src/common/`)

| Componente | Rol |
|---|---|
| `JwtAuthGuard` | Autenticación JWT; respeta `@Public()` |
| `RolesGuard` | Autorización por rol (`@Roles()`) |
| `ThrottlerGuard` + `ResilientThrottlerStorage` | Rate limiting; degrada a memoria si Redis cae |
| `ZodValidationPipe` / `UuidParamPipe` | Validación de entrada, anti mass-assignment |
| `HttpExceptionFilter` | Errores centralizados; redacta detalles 5xx en prod |
| `ResponseInterceptor` | Forma de respuesta uniforme |
| `HttpMetricsInterceptor` / `HttpMetricsService` | Métricas Prometheus por request |
| `requestIdMiddleware` | Correlation ID saneado contra inyección de cabeceras |
| `RedisModule` | Cliente Redis opcional |

## Módulos de dominio (`src/modules/`)

Cada módulo sigue controller → service → repository (+ mapper + schemas). Núcleo de aplicación:

| Módulo | Responsabilidad |
|---|---|
| `auth` | Registro, login, JWT; delega identidad a `users` |
| `users` | Identidad autenticada (proveedor hoja) |
| `profiles` | Onboarding, antropometría, medidas |
| `equipment` | Catálogo de equipamiento (proveedor hoja) |
| `facilities` | Sedes, salas, puntos de acceso, mantenimiento |
| `membership` | Planes, membresías, entitlements, staff (18 models) — agregado más grande |
| `access-control` | Credenciales, dispositivos, decisiones de acceso físico |
| `notifications` | Preferencias, entrega, recordatorios |
| `exercises` | Catálogo + media + sync de dataset externo |
| `workouts` | Sesiones y sets de entrenamiento |
| `training` | Rutinas, ejercicios de rutina, asignaciones |
| `export` | Exportación JSON/CSV agregando otros dominios |
| `integration` | **Outbox transaccional + domain events + import heredado** (hub) |
| `health` | Liveness/readiness/metrics |
| `gateway` | Endpoints operativos públicos `/gateway/*` |

> El directorio `access-control/` contiene **dos** clases de módulo:
> `AccessControlModule` y `AccessCredentialModule` (esta última importa `users` y es reusada por
> `membership`). Solo `AccessControlModule` se registra en `AppModule`.

## Componente central: outbox (`integration`)

`OutboxService`/`OutboxRepository` (claim `FOR UPDATE SKIP LOCKED`, complete/fail con fencing),
`DomainEventPublisher`/`DomainEventRepository` (ledger append-only), `OutboxMetricsService` y
`OutboxRetentionService`. Es el componente del que dependen 5 módulos.
Ver [[07-async-processing/events]] y [[02-architecture/dependency-map]].
