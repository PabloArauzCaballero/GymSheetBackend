---
type: runbook
status: verified
last_reviewed: 2026-08-06
source_revision: 27f3fd2
tags: [backend, operations, runbook, workers]
---

# Runbook — worker detenido

- **Síntoma:** una cola no avanza; falta `worker.started` reciente; el contenedor de un worker
  reinicia en bucle o está caído.
- **Impacto:** el trabajo asíncrono de esa cola se acumula (notificaciones no enviadas, eventos de
  acceso sin procesar, dataset sin refrescar). La API sigue sirviendo tráfico.
- **Severidad:** alta (crítica si es `worker-access` y bloquea decisiones de acceso físico).

## Señales

- Ausencia de `worker.started`; presencia de `worker.bootstrap_failed` o `*.poll_failed` repetido.
- `gym_sheet_outbox_backlog_age_seconds{queue}` creciente con `PROCESSING` estancado.
- Alerta "Worker stalled" (`PROCESSING > 0` sin cambio mientras sube la antigüedad del backlog).
- `docker compose ps` muestra el worker `restarting`/`exited`.

## Diagnóstico

```bash
docker compose ps
docker compose logs --tail=200 worker-notifications   # o el worker afectado
curl -s http://localhost:3001/api/v1/health/metrics | grep gym_sheet_outbox
```

Buscar: fallo de conexión a Postgres (`*.poll_failed`), `worker.bootstrap_failed` (config/env
inválida), o error de dominio recurrente.

## Mitigación

- Reiniciar el worker: `docker compose restart worker-<x>` (la política `unless-stopped` ya reintenta).
- Si es config/env: corregir la variable y redeploy (recordar que `env.ts` falla-rápido).
- Escalar temporalmente para drenar backlog: `docker compose up -d --scale worker-notifications=3`
  (ver [[../scaling]]). No superar `DB_POOL_MAX`.

## Recuperación

Los jobs que el worker sostenía quedaron `PROCESSING` con lease; tras `WORKER_LOCK_TIMEOUT_MS` otra
réplica o el worker reiniciado los reclama (condición `locked_at < now() - lockTimeout`). Ningún job
se pierde. Ver [[../../07-async-processing/ordering-and-concurrency]].

## Validación

- `worker.started` en logs; backlog age decreciente; `PROCESSING` fluye a `COMPLETED`.
- Contadores `gym_sheet_outbox_jobs` normalizándose.

## Rollback

Si el fallo llegó con un release nuevo, revertir la imagen del worker (misma imagen que la API) según
[[../rollback]].

## Escalamiento

Si tras reinicio persiste `bootstrap_failed`, escalar a Ingeniería con logs y la variable sospechosa.
`worker-access` bloqueado con impacto físico → escalar de inmediato.

## Prevención

- Alertas de "Worker stalled" y backlog age ya propuestas
  (`docs/operations/observability-and-alerts.md`).
- Validar `flushLogs()` presente (lo está en `worker-bootstrap.ts`) para no correr a ciegas.
- Probar cierre controlado: `docker compose stop` debe mostrar `worker.shutdown_requested`.

## Referencias

[[../../07-async-processing/workers]] · [[../../07-async-processing/retry-and-dead-letter]] ·
[[../startup-shutdown]] · `docs/operations/docker-and-messaging.md`
