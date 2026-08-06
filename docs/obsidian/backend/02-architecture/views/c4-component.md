---
title: "Vista C4 — Componentes (API)"
type: architecture
status: verified
last_reviewed: "2026-08-06"
source_revision: "27f3fd2"
tags: [backend, architecture]
---

# Vista C4 — Nivel 3 (Componentes de la API)

Componentes internos de la API por capas. Detalle: [[02-architecture/components]] y
[[02-architecture/module-boundaries]].

```mermaid
flowchart TB
  req[HTTP request]

  subgraph edge[Transversal common]
    mw[requestId + helmet + CORS]
    guards["Throttler, Jwt, Roles"]
    pipe[ZodValidationPipe]
    filt[HttpExceptionFilter]
    resp[ResponseInterceptor + metrics]
  end

  subgraph domain[Modulos de dominio]
    ctrl[Controllers]
    svc[Services]
    repo[Repositories]
    map[Mappers]
  end

  subgraph core[Nucleo async]
    intg[integration: outbox + domain events]
  end

  pg[(PostgreSQL)]

  req --> mw --> guards --> pipe --> ctrl --> svc
  svc --> repo --> pg
  svc --> intg --> pg
  svc --> map --> resp
```

## Explicación

El flujo entra por componentes transversales de `common/` (guards en orden Throttler → Jwt → Roles),
pasa a `controller → service → repository` dentro de cada módulo, y las escrituras asíncronas se
canalizan por `integration` (outbox + domain events) en la misma transacción. Los mappers evitan
devolver modelos ORM. Ver [[02-architecture/data-flow]].
