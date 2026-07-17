# Performance budget and load verification

## Purpose

The repository includes `test/load/http-load-smoke.mjs` to detect obvious regressions in bounded reads, workout writes, exports, memory use and abuse controls.

This is a CI smoke test. It is evidence that the tested commit behaves within the declared limits on the GitHub runner; it is not a production capacity certification.

## CI workload

The default run creates a synthetic user and a minimal workout, then executes:

| Operation | Requests | Concurrency |
|---|---:|---:|
| paginated exercise reads | 60 | 10 |
| workout-set writes | 20 | 10 |
| bounded JSON exports | 15 | 10 |

It also verifies:

- a body larger than `REQUEST_BODY_LIMIT` returns HTTP `413`;
- repeated authentication attempts eventually return HTTP `429`;
- no tested request fails;
- RSS growth stays bounded during the run.

## Default budgets

| Signal | Budget |
|---|---:|
| exercise-read p95 | ≤ 800 ms |
| exercise-read p99 | ≤ 1600 ms |
| workout-write p95 | ≤ 1400 ms |
| export p95 | ≤ 1400 ms |
| RSS growth during measured window | ≤ 64 MiB |

Budgets are configurable through environment variables used by the script:

```txt
LOAD_READ_REQUESTS
LOAD_WRITE_REQUESTS
LOAD_EXPORT_REQUESTS
LOAD_CONCURRENCY
BUDGET_READ_P95_MS
BUDGET_READ_P99_MS
BUDGET_WRITE_P95_MS
BUDGET_EXPORT_P95_MS
BUDGET_RSS_GROWTH_BYTES
```

Do not loosen a budget only to make CI green. A change requires a recorded explanation, comparison with the previous baseline and confirmation that the deployment capacity remains acceptable.

## Production capacity test

Before first production approval, run a separate test against a staging environment with production-like:

- PostgreSQL version and connection limits;
- network latency;
- data volume and index distribution;
- container CPU and memory limits;
- reverse proxy and TLS;
- concurrent authenticated users.

Record request rate, error rate, p50/p95/p99, RSS, heap, event-loop delay, pool saturation and PostgreSQL query timings. Stop the test before it can affect shared or production infrastructure.

## Interpretation

A flat heap with rising RSS can indicate native buffers or client-library pressure. Rising heap after repeated stable workloads can indicate retained JavaScript references. Pool `waiting > 0` indicates requests are queueing for database connections and should be investigated before increasing the pool.
