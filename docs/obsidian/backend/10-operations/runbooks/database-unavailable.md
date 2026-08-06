---
type: runbook
status: verified
last_reviewed: 2026-08-06
source_revision: 27f3fd2
tags: [backend, operations, runbook, database]
---

# Runbook — base de datos no disponible

- **Síntoma:** `GET /health/ready` devuelve 503; workers loguean `*.poll_failed`; errores de conexión
  a PostgreSQL.
- **Impacto:** las escrituras y la mayoría de lecturas fallan; los workers no reclaman trabajo. La
  **liveness** de la API sigue 200 (no reinicia).
- **Severidad:** crítica.

## Señales

- `/health/ready` 503; `/health/live` 200.
- `gym_sheet_database_pool_connections` con `waiting > 0` o saturación; alerta "Pool saturation".
- `postgres` `unhealthy` en `docker compose ps` (`pg_isready` falla).
- Logs de worker `*.poll_failed` con error de conexión.

## Diagnóstico

```bash
docker compose ps postgres
docker compose logs --tail=100 postgres
docker compose exec postgres pg_isready -U "$DB_USER" -d "$DB_NAME"
curl -s http://localhost:3001/api/v1/health/ready
```

Distinguir: Postgres caído vs. pool agotado (`DB_POOL_MAX`) vs. `statement_timeout`
(`DB_STATEMENT_TIMEOUT_MS`) vs. red.

## Mitigación

- Postgres caído: `docker compose up -d postgres`; esperar `healthy`.
- Pool saturado: reducir carga (escalar down workers `--scale worker-x=1`), revisar consultas lentas;
  ajustar `DB_POOL_MAX` con criterio (`.claude/rules/50-performance.md`).
- No reiniciar la API en bucle: por diseño la liveness no reinicia durante la caída de dependencia.

## Recuperación

Al volver Postgres, la readiness se restaura **sin** reinicio de la API. Los workers reanudan el
polling; el trabajo encolado es durable (no se perdió). Leases huérfanos se reclaman tras
`WORKER_LOCK_TIMEOUT_MS`.

## Validación

`/health/ready` 200; pool sin `waiting`; workers procesando; backlog age bajando.

## Rollback

Si la caída siguió a un cambio de esquema, ver [[failed-migration]] y [[../rollback]]. Si hay
corrupción/pérdida, restaurar desde backup: [[../disaster-recovery]].

## Escalamiento

Pérdida de datos, corrupción o Postgres que no recupera → escalar a DBA/Infra con logs y último
backup verificado.

## Prevención

- Healthchecks que **gatean** dependientes (`postgres` healthy antes de API/workers).
- `statement_timeout` y pool configurados por entorno; alertas de pool y readiness.
- Backups verificados y ensayo de restore (CI). Ver [[../disaster-recovery]].

## Referencias

[[../health-checks]] · [[../disaster-recovery]] · [[failed-migration]] ·
`docs/operations/observability-and-alerts.md`
