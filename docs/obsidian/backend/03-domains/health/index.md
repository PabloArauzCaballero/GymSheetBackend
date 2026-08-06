---
title: "Health"
type: domain
status: verified
criticality: medium
last_reviewed: "2026-08-06"
source_revision: "27f3fd2"
domain: "health"
source_files: [
  "src/modules/health/health.controller.ts",
  "src/modules/health/health.service.ts",
  "src/modules/health/metrics-scrape.guard.ts",
  "src/modules/health/health.module.ts"
]
tags: [backend, domain]
related: ["[[03-domains/integration/index]]", "[[09-observability/index]]"]
---

# Health

## Resumen

Sondas de salud reales y métricas Prometheus. `/health/live` (liveness sin dependencias),
`/health/ready` (readiness: Postgres, paridad de migraciones, Redis), `/health/metrics` (métricas HTTP
+ outbox, protegidas por token).

## Responsabilidad

- Exponer liveness/readiness fiables para orquestador y balanceador.
- Publicar métricas Prometheus, incluidas las de la cola de `integration`.

## Límites

- No corrige dependencias; solo reporta.
- Liveness no depende de ninguna dependencia (nunca 503 por Postgres/Redis).

## Entradas

HTTP `GET /health/{live,ready,metrics}`.

## Salidas

`LivenessResponse`, `ReadinessResponse`; texto Prometheus.

## Casos de uso

Probes de Kubernetes/compose; scraping de Prometheus.

## Reglas de negocio

- `getReadiness`: `SELECT 1` + lee `app_meta.schema_migrations`; error → 503 genérico (sin filtrar
  detalles de BD); migraciones pendientes → 503 nombrándolas; Redis configurado pero inalcanzable →
  503; Redis no configurado → `not-configured`.
- `findPendingMigrationIds`: migraciones del build menos las aplicadas; migraciones extra en BD se
  ignoran (seguro para despliegue rolling).

## Componentes principales

| Componente | Tipo | Responsabilidad | Evidencia |
|---|---|---|---|
| `HealthController` | Controller | `/health/{live,ready,metrics}` | `health.controller.ts` |
| `HealthService` | Service | Liveness/readiness, resolución de Redis | `health.service.ts` |
| `MetricsScrapeGuard` | Guard | Protege `/health/metrics` con token | `metrics-scrape.guard.ts` |

## Entidades y datos

Sin modelos; lee `app_meta.schema_migrations` por SQL raw y `databaseMigrations` del build. Detalle:
[[05-data/index]].

## Endpoints o contratos

`GET /health/live`, `GET /health/ready` (públicos), `GET /health/metrics`
(`Content-Type: text/plain; version=0.0.4`, `@UseGuards(MetricsScrapeGuard)`). Clase `@Public()` +
`@SkipThrottle()`. [[04-api/index]].

## Eventos

Consume `OutboxMetricsService.renderPrometheus()` de `integration`.

## Dependencias

`IntegrationModule` (OutboxMetricsService), `HttpMetricsService`, `Sequelize`, `REDIS_CLIENT` opcional,
`databaseMigrations`.

## Autenticación y permisos

Rutas `@Public()` (evitan `JwtAuthGuard`). `/health/metrics` con `MetricsScrapeGuard`: si
`METRICS_SCRAPE_TOKEN` no está definido → abierto (compatibilidad); si está, requiere
`Authorization: Bearer <token>` comparado con `timingSafeEqual`; fallo → 401. `@SkipThrottle()` para
que las sondas no dependan del backend de rate limiting.

## Manejo de errores

Fallos de readiness colapsan a 503 genérico sin filtrar errores de BD; IDs de migración pendiente se
nombran (nombres internos). El guard nunca devuelve el token esperado.

## Transacciones y consistencia

N/A (solo lecturas).

## Procesamiento asíncrono

Ninguno; las métricas reflejan el estado de workers/outbox leído en vivo de BD.

## Observabilidad

Es el punto de observabilidad. Ver [[09-observability/index]].

## Pruebas

- `health.service.spec.ts` — liveness sin deps; ready feliz; 503 ocultando error de BD; 503 por esquema
  atrasado y nombrando migración; 503 registro vacío; Redis not-configured/ready/unreachable; tolera
  migración extra futura.
- `metrics-scrape.guard.spec.ts` — abierto sin token; admite token correcto; rechaza (header ausente,
  bearer vacío, longitud igual pero distinto, truncado, con padding, esquema erróneo, token crudo); no
  hace eco del token esperado.

## Riesgos

- `SEC-1` — `/health/metrics` abierto por defecto si `METRICS_SCRAPE_TOKEN` no está configurado:
  expone topología/tráfico si la red no está restringida (documentado, pero footgun de despliegue).
- `SELECT 1` + lectura de migraciones en cada probe; acotado por statement timeout pero añade carga de
  BD bajo sondeo agresivo (`INFERIDO` menor).

## Referencias al código

- `health.service.ts` → `getLiveness`, `getReadiness`, `resolveRedisStatus`,
  `findPendingMigrationIds`.
- `metrics-scrape.guard.ts` → `canActivate` (comparación de tiempo constante).

## Relaciones

[[03-domains/integration/index]] · [[09-observability/index]]
