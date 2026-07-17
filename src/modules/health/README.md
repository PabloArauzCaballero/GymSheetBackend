# Health and observability module

## Endpoints

```txt
GET /api/v1/health/live
GET /api/v1/health/ready
GET /api/v1/health/metrics
```

All three routes are public and remain subject to the global rate limiter. The reverse proxy should restrict `/metrics` to the monitoring network in production.

## Liveness

`/live` verifies only that the Node.js process can answer HTTP requests. It does not query PostgreSQL. An orchestrator can use it to decide whether the process is stuck and must be restarted.

## Readiness

`/ready` executes a bounded `SELECT 1` through Sequelize. It returns success only when the application can reach PostgreSQL. An ingress, load balancer, or orchestrator can remove an instance from traffic while this endpoint is failing.

## Metrics

`/metrics` returns Prometheus-compatible text and includes:

- process uptime, resident memory and used heap;
- Sequelize pool size, available, in-use and waiting connections;
- bounded HTTP request counters;
- bounded HTTP duration histograms;
- the count of observations dropped after the cardinality guard is reached.

HTTP labels contain only method, route template and status. Raw URLs, query strings, authorization data, bodies, user IDs and database statements are not recorded. The in-process registry admits at most 250 HTTP series to prevent observability from becoming a memory leak.

## Operational rules

Do not add every external dependency to liveness. Temporary dependency outages should not cause restart loops. Add a dependency to readiness only when the API cannot safely serve meaningful traffic without it.

Health responses do not expose hostnames, credentials, SQL errors, stack traces or provider-specific details. Pool statistics are available only through the metrics endpoint and should be protected at the network edge.
