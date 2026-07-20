# Observability and alerting runbook

## Scope

GymSheet exposes low-cardinality Prometheus-compatible metrics at:

```txt
GET /api/v1/health/metrics
```

The endpoint is public at the NestJS routing layer so a platform probe can reach it, but production ingress must restrict it to the monitoring network, service account or private route. Do not expose it to the public internet without an explicit operational decision.

## Available signals

| Metric | Meaning | Operational use |
|---|---|---|
| `gym_sheet_process_uptime_seconds` | Process lifetime | Detect restart loops |
| `gym_sheet_process_resident_memory_bytes` | Resident memory | Detect growth and container pressure |
| `gym_sheet_node_heap_used_bytes` | Used V8 heap | Distinguish heap growth from native memory |
| `gym_sheet_database_pool_connections` | Pool state by `size`, `available`, `using`, `waiting` | Detect saturation and queueing |
| `gym_sheet_http_requests_total` | Completed requests by method, route template and status | Error-rate and traffic monitoring |
| `gym_sheet_http_request_duration_seconds` | Request latency histogram | p50, p95 and p99 latency |
| `gym_sheet_http_metric_series_dropped_total` | New series rejected by the cardinality guard | Detect route-label drift or abuse |

The metrics registry is intentionally bounded to 250 HTTP series. It never stores request bodies, query parameters, tokens, email addresses or user identifiers.

## Initial alert proposals

These are safe starting points, not production facts. They must be adjusted after observing real traffic and infrastructure limits.

| Alert | Initial condition | Window | Severity |
|---|---|---:|---|
| API unavailable | readiness fails | 2 minutes | critical |
| Elevated 5xx rate | 5xx / all requests > 2% and at least 20 requests | 5 minutes | high |
| Read latency | p95 > 800 ms for read routes | 10 minutes | warning |
| Write latency | p95 > 1.4 s for workout writes | 10 minutes | warning |
| Pool saturation | `waiting > 0` or `using / size > 0.9` | 5 minutes | high |
| Memory pressure | RSS > 80% of container limit | 10 minutes | high |
| Cardinality guard active | dropped series increases | 5 minutes | warning |
| Connector failure | dataset import returns 5xx | 3 consecutive attempts | warning |

## Dashboards

At minimum, create panels for:

1. request rate and status distribution;
2. p50, p95 and p99 latency by route template;
3. RSS and heap over time;
4. PostgreSQL pool size, in-use, available and waiting;
5. readiness failures and process restarts;
6. dataset import failures and duration from structured logs.

## Log policy

Application logs are structured objects emitted through NestJS. Production logs must:

- be collected from standard output by the deployment platform;
- redact authorization headers, passwords, tokens and connection strings;
- avoid request and response bodies by default;
- include request ID, method, normalized route or path, status and event name;
- omit stack traces and raw infrastructure messages from client responses;
- restrict access through least privilege.

A proposed baseline is 30 days of searchable retention and 90 days of archived retention. This is not a legal requirement and must be approved against the organization’s privacy, audit and cost policy before deployment.

## Incident workflow

```txt
Alert
→ verify readiness and recent deploys
→ inspect error rate and latency
→ inspect pool and memory
→ correlate by request ID
→ mitigate or roll back
→ preserve evidence
→ document root cause and corrective action
```

Never increase pool size, timeouts or memory limits as the first response without identifying the bottleneck. That can hide saturation and move failure to PostgreSQL or the host.
