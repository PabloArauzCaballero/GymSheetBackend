---
title: "Vista C4 — Contenedores"
type: architecture
status: verified
last_reviewed: "2026-08-06"
source_revision: "27f3fd2"
tags: [backend, architecture]
---

# Vista C4 — Nivel 2 (Contenedores)

Procesos desplegables y datastores. Detalle: [[02-architecture/containers-and-services]].

```mermaid
flowchart TB
  cli[Cliente / adapter]:::person

  subgraph gymsheet[GymSheet Backend]
    api["API NestJS Node HTTP"]:::cont
    wa[worker-access]:::cont
    wr[worker-reminders]:::cont
    wn[worker-notifications]:::cont
    wd[worker-exercises-dataset]:::cont
    mig[migrate one-shot]:::cont
  end

  pg[(PostgreSQL 16)]:::db
  rd[(Redis 7)]:::db
  gw[Gateway externo]:::ext
  ds[Dataset externo]:::ext

  cli --> api
  api --> pg
  api --> rd
  mig --> pg
  wa --> pg
  wr --> pg
  wn --> pg
  wn --> gw
  wd --> pg
  wd --> ds

  classDef person fill:#08427b,color:#fff
  classDef cont fill:#1168bd,color:#fff
  classDef db fill:#2e7d32,color:#fff
  classDef ext fill:#999,color:#fff
```

## Explicación

Todos los contenedores de aplicación comparten una imagen y difieren en el `command`. `migrate` corre
antes que todo (one-shot). Los workers no exponen HTTP y se coordinan solo por PostgreSQL
(`SKIP LOCKED`). Redis solo guarda contadores de rate limiting. Ver
[[02-architecture/deployment-topology]] y siguiente nivel [[02-architecture/views/c4-component]].
