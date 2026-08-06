---
title: "Health checks"
type: observability
status: verified
criticality: high
last_reviewed: "2026-08-06"
source_revision: "27f3fd2"
source_files:
  - "src/modules/health/health.controller.ts"
  - "src/modules/health/health.service.ts"
  - "src/workers/worker-bootstrap.ts"
tags: [backend, observability, health, readiness, liveness]
---

# Health checks

## Endpoints (VERIFICADO)

Controlador `@Public()` y `@SkipThrottle()` — las sondas **nunca** dependen del backend de rate
limiting (`health.controller.ts:9,16`). Si el throttler corriera aquí, una caída de Redis haría fallar
la sonda de liveness y reiniciaría procesos sanos en bucle.

### `GET /health/live` — Liveness
- Reporta solo que el proceso Node puede servir HTTP.
- **Sin dependencias externas**: no toca PostgreSQL ni Redis (`health.service.ts:33-38`).
- **Siempre 200** mientras el proceso viva. Un fallo temporal de base de datos **no** debe reiniciar
  el proceso.

### `GET /health/ready` — Readiness
Verifica que la instancia puede recibir tráfico (`health.service.ts:44-79`). Devuelve **503** si:

1. **PostgreSQL** no responde (`SELECT 1`, acotado por statement timeout) → 503.
2. **Migraciones pendientes**: compara las migraciones del build con `app_meta.schema_migrations`; si
   el esquema está **desactualizado** respecto al código, responde 503 nombrando las migraciones
   pendientes (identificadores internos, no datos sensibles). Corrección de F-010.
   - Migraciones presentes en la DB pero ausentes del build se **ignoran** a propósito: durante un
     rolling deploy, una instancia vieja no debe salir de rotación por migraciones de una nueva.
3. **Redis configurado pero inalcanzable**: se trata como **not ready** (503) porque el rate limiting
   dejaría de compartirse entre instancias — degradación relevante de seguridad. Un Redis **no
   configurado** se reporta `not-configured` y **no** bloquea readiness (`health.service.ts:87-98`).

Respuesta OK incluye `dependencies: { database: 'ready', migrations: 'up-to-date', redis: 'ready' | 'not-configured' }`.

## Workers (VERIFICADO — F-016)

Los workers **no exponen HTTP**, por lo que **no** deben someterse a un healthcheck HTTP. En Docker,
el `HEALTHCHECK` de la imagen se **deshabilita** para los servicios worker (`healthcheck: disable`);
para un worker, la liveness es la vida del proceso, cubierta por la política de reinicio. Sin esta
corrección quedaban permanentemente *unhealthy*. Su observabilidad viene de los logs (`worker.started`,
`worker.shutdown_requested`) — ver [[09-observability/logging]].

## Uso operativo

- **Orquestador**: liveness → reiniciar proceso muerto; readiness → sacar de rotación instancia no
  lista sin matarla.
- **Métricas**: `/health/metrics` sirve Prometheus (endpoint separado, protegible) —
  [[09-observability/metrics]].

## Brechas

- Readiness no verifica gateways externos (WhatsApp, dataset) a propósito: son dependencias no
  críticas para servir tráfico; su salud se observa por logs/métricas de dataset.

Relacionado: [[09-observability/metrics]] · [[09-observability/alerts]] · [[10-operations/observability-and-alerts]] · [[08-security/security-findings]].
