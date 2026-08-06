---
type: async-processing
status: verified
last_reviewed: 2026-08-06
source_revision: 27f3fd2
tags: [backend, async, concurrency, locking]
---

# Orden y concurrencia

## Claim atómico con `FOR UPDATE SKIP LOCKED`

Ambas colas (`integration.outbox_jobs` y `access_control.device_events`) reclaman trabajo con el
mismo patrón (`OutboxRepository.claim`, `AccessControlRepository.claimEvents`):

```sql
WITH candidates AS (
  SELECT id FROM <cola>
  WHERE <due> AND (status IN ('PENDING','FAILED')
        OR (status='PROCESSING' AND locked_at < now() - (:lockTimeoutMs * interval '1 millisecond')))
  ORDER BY <created_at|received_at> ASC
  FOR UPDATE SKIP LOCKED
  LIMIT :limit
)
UPDATE <cola> SET status='PROCESSING', attempt_count = attempt_count + 1,
                  locked_at = now(), locked_by = :workerId
FROM candidates WHERE ...
RETURNING id;
```

- `FOR UPDATE SKIP LOCKED` garantiza que **dos réplicas nunca reclaman el mismo job** → escalado
  horizontal sin cambiar código (`--scale worker-notifications=3`). Ver
  [[../10-operations/scaling]].
- El `claim` es una transacción: selecciona candidatos, los marca `PROCESSING` y los relee.

## Orden

Orden **FIFO best-effort** por `created_at ASC` (outbox) / `received_at ASC` (access) dentro del
lote. **No hay orden global garantizado** entre lotes ni entre réplicas concurrentes: con
`WORKER_CONCURRENCY > 1` varios jobs del lote se procesan en paralelo (`runBounded`). Si un flujo
exigiera orden estricto, no está soportado hoy (INFERIDO: el dominio —notificaciones, accesos por
minuto— no lo requiere; ADR-0005 §carga).

## Concurrencia y prefetch

| Parámetro | Default | Rango | Efecto |
|---|---|---|---|
| `WORKER_BATCH_SIZE` | 50 | 1–500 | Jobs reclamados por ciclo (prefetch / `LIMIT`) |
| `WORKER_CONCURRENCY` | 5 | 1–50 | Handlers en paralelo dentro del lote (`runBounded`) |
| `WORKER_POLL_INTERVAL_MS` | 1000 | 100–60000 | Espera cuando no hay trabajo |
| `WORKER_LOCK_TIMEOUT_MS` | 300000 | 5000–3.6e6 | Tras este tiempo un `PROCESSING` huérfano es reclamable |

`runBounded(items, concurrency, handler)` procesa el lote en sub-lotes de tamaño `concurrency` con
`Promise.all`.

## Recuperación de leases huérfanos (crash recovery)

Si un worker muere sosteniendo un job, su fila queda `PROCESSING` con `locked_at` viejo. Pasado
`WORKER_LOCK_TIMEOUT_MS`, otra réplica (o el worker reiniciado) lo vuelve a reclamar por la condición
`locked_at < now() - lockTimeout`. Ningún job se pierde. El lease check en el ack
(`locked_by`+`attempt_count`) evita que el worker original, si revive, pise el trabajo del nuevo.
Ver [[idempotency]] y [[../10-operations/runbooks/worker-stopped]].

## No contención con mantenimiento

La poda de retención también usa `FOR UPDATE SKIP LOCKED`, por lo que no compite con el `claim` de
los workers ([[batch-jobs]]). Rendimiento del `claim`: índice `ix_outbox_claim`.
