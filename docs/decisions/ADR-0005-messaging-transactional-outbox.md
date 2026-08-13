# ADR-0005 — Mensajería asíncrona: outbox transaccional sobre PostgreSQL

Estado: aceptado  
Fecha: 2026-08-01

## Contexto

El backend necesita procesamiento asíncrono desacoplado para tres flujos:

- **Accesos físicos** (`access.decisions`): eventos de molinete que deben decidirse fuera del ciclo
  HTTP del adapter.
- **Recordatorios de membresía** (`membership.reminders`): barridos periódicos que generan avisos.
- **Entrega de notificaciones** (`notifications.delivery`): envío por proveedor (IN_APP / HTTP
  gateway) con reintentos.

Un requisito de infraestructura pidió evaluar la incorporación de un servicio de mensajería
(RabbitMQ, Redis Streams, Kafka u otro) como parte de la dockerización, exigiendo justificación
técnica según volumen, latencia, complejidad y costo operativo, y sin romper la arquitectura
existente.

La regla `.claude/rules/10-backend-architecture.md` ya fija: «El trabajo asíncrono va por el outbox
transaccional (`integration.outbox_jobs`) + workers, con reintentos finitos, backoff y dead-letter.
**No introduzcas colas externas sin ADR.**» Este ADR es ese análisis.

## Características de carga (dominio real)

- Dominio: operación de un gimnasio (o pocas sedes). Órdenes de magnitud de eventos: accesos y
  notificaciones **por minuto**, no por segundo. No hay streaming, ni fan-out masivo, ni
  reprocesamiento analítico de historiales.
- Latencia aceptable de extremo a extremo: **segundos**. El intervalo de polling por defecto es
  `WORKER_POLL_INTERVAL_MS=1000`.
- Requisito duro: **atomicidad** entre el cambio de estado de negocio y el encolado del trabajo
  derivado. Encolar una notificación por una membresía que la transacción luego revierte, o
  perderla si el proceso cae entre el `COMMIT` y el `publish`, es inaceptable (problema clásico de
  la doble escritura DB + broker).

## Decisión

Se conserva y se consolida el **patrón outbox transaccional** sobre PostgreSQL como único mecanismo
de mensajería asíncrona. No se incorpora ningún broker externo.

Diseño vigente (`src/modules/integration/`, `src/workers/`):

```text
servicio de dominio (transacción Sequelize)
  → INSERT en integration.outbox_jobs (mismo COMMIT que el cambio de negocio)
  → worker: claim con FOR UPDATE SKIP LOCKED (lease por worker_id + locked_at)
  → handler idempotente
  → COMPLETED  |  FAILED (+ backoff exponencial)  |  DEAD_LETTER (agotados los intentos)
```

Propiedades ya implementadas y verificadas en código:

| Capacidad de mensajería | Implementación |
|---|---|
| Productor/consumidor desacoplados | `OutboxService.enqueue` en transacción; runners consumen |
| Colas separadas por tipo | columna `queue_name` |
| Confirmación (ack) exactamente-una-vez lógica | `markCompleted` con lease check (`locked_by` + `attempt_count`) |
| Reintentos + backoff | `markFailed`: `min(3600, 2^intento·5)` s |
| Dead-letter | estado `DEAD_LETTER` al superar `max_attempts` |
| Prevención de duplicados / idempotencia | `deduplication_key` único + handlers idempotentes |
| Concurrencia + prefetch | `WORKER_CONCURRENCY`, `WORKER_BATCH_SIZE` |
| Escalado horizontal sin tocar código | `FOR UPDATE SKIP LOCKED` ⇒ N réplicas seguras |
| Recuperación tras caída | reclamo por lease vencido (`locked_at < now() - lockTimeout`) + `restart` |
| Cierre controlado | `AbortSignal` + SIGTERM/SIGINT + `application.close()` |
| Observabilidad | logs estructurados por `event` + métricas de cola en `/health/metrics` (este cambio) |

## Alternativas evaluadas

| Criterio | Outbox + PostgreSQL (elegido) | RabbitMQ | Redis Streams | Kafka |
|---|---|---|---|---|
| Atomicidad con datos de negocio | **Nativa** (mismo COMMIT) | Doble escritura (necesita outbox igual) | Doble escritura | Doble escritura |
| Infra nueva a operar | **Ninguna** (ya hay PostgreSQL) | Broker + cluster + DLX | Redis persistente (hoy es efímero) | ZK/KRaft + brokers |
| Complejidad operativa | **Baja** | Media | Media | Alta |
| Volumen soportado | Suficiente (miles/min) | Alto | Alto | Muy alto (streaming) |
| Costo de salida (lock-in) | **Mínimo** | Medio | Bajo | Alto |
| Ajuste al volumen real | **Exacto** | Sobredimensionado | Sobredimensionado | Muy sobredimensionado |

Punto clave: incluso adoptando un broker, **seguiría haciendo falta un outbox** para no perder
mensajes en la frontera transacción/publicación. El broker añadiría un componente sin eliminar el
que ya resuelve el problema.

Redis en este stack está deliberadamente configurado como **efímero** (solo contadores de rate limit,
`--appendonly no`, `--save ""`, `allkeys-lru`). Reutilizarlo como cola exigiría persistencia,
política de memoria distinta y otro modelo de durabilidad: sería un segundo sistema, no una
reutilización.

## Límites y disparadores de reevaluación

Este ADR deja de aplicar y debe revisarse si, **con evidencia medida**, se cumple alguno:

1. Backlog sostenido de `PENDING` que el polling no drena aun escalando workers (medir con
   `gym_sheet_outbox_jobs{status="PENDING"}` y `gym_sheet_outbox_backlog_age_seconds`).
2. Necesidad de latencia sub-segundo consistente (el polling no es la herramienta).
3. Fan-out a múltiples consumidores heterogéneos por evento, o streaming/replay analítico.
4. La carga de `claim` compite de forma dañina con el tráfico OLTP en la misma instancia.

Antes de introducir un broker se evaluaría primero `LISTEN/NOTIFY` de PostgreSQL para eliminar la
latencia de polling manteniendo la atomicidad.

## Consecuencias

Positivas:

- Cero infraestructura de mensajería nueva; menor superficie de fallo y de ataque.
- Entrega atómica con el cambio de negocio; sin doble escritura ni pérdida en la frontera.
- Escalado horizontal de workers ya soportado (`SKIP LOCKED`).
- Observabilidad de cola por métricas Prometheus (pendientes, en proceso, fallidos, dead-letter,
  antigüedad de backlog).

Costos / pendientes reales:

- La latencia mínima está acotada por `WORKER_POLL_INTERVAL_MS` (mitigable con `LISTEN/NOTIFY`).
- Los jobs `COMPLETED` crecen de forma append-only. Se provee un comando de retención opt-in
  (`yarn db:outbox:prune`, dry-run por defecto) que borra en lotes solo `COMPLETED` más antiguos que
  `OUTBOX_RETENTION_DAYS`; nunca toca PENDING/PROCESSING/FAILED/DEAD_LETTER. No se auto-programa: lo
  dispara un scheduler externo. Las métricas de cola **no** cuentan `COMPLETED` para no escanear una
  tabla creciente. Pendiente futuro (si el volumen lo exige): particionado por tiempo.
- El rendimiento de `claim` depende del índice `ix_outbox_claim (queue_name, status, available_at,
  created_at)`; no relajarlo sin medir.

## Referencias

- Patrón Transactional Outbox (microservices.io / Chris Richardson).
- PostgreSQL `SELECT ... FOR UPDATE SKIP LOCKED` (colas concurrentes sin doble procesamiento).
- ADR-0002 (frontera PACS): origen de la cola de accesos.
- `.claude/rules/10-backend-architecture.md`, `.claude/rules/50-performance.md`,
  `.claude/rules/80-database.md`.
