# Health module

## Endpoints

```txt
GET /api/v1/health/live
GET /api/v1/health/ready
```

Both routes are public and remain subject to the global rate limiter.

## Liveness

`/live` verifies only that the Node.js process can answer HTTP requests. It does not query PostgreSQL. An orchestrator can use it to decide whether the process is stuck and must be restarted.

## Readiness

`/ready` executes a bounded `SELECT 1` through Sequelize. It returns success only when the application can reach PostgreSQL. An ingress, load balancer, or orchestrator can remove an instance from traffic while this endpoint is failing.

## Operational rule

Do not add every external dependency to liveness. Temporary dependency outages should not cause restart loops. Add a dependency to readiness only when the API cannot safely serve meaningful traffic without it.

The endpoints do not expose hostnames, credentials, pool statistics, SQL errors, stack traces, or provider-specific details.
