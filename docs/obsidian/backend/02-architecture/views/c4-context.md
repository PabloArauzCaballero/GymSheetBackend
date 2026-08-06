---
title: "Vista C4 — Contexto"
type: architecture
status: verified
last_reviewed: "2026-08-06"
source_revision: "27f3fd2"
tags: [backend, architecture]
---

# Vista C4 — Nivel 1 (Contexto)

Aproximación C4 con `flowchart` de Mermaid. El sistema como caja negra frente a actores y sistemas
externos. Detalle: [[02-architecture/system-context]].

```mermaid
flowchart TB
  cli[Cliente socio]:::person
  staff[Personal / Admin]:::person
  ops[Operador / SRE]:::person

  sys[GymSheet Backend]:::sys

  hw[Molinete / PACS]:::ext
  wa[Gateway notificaciones WhatsApp]:::ext
  ds[Dataset ejercicios externo]:::ext
  prom[Prometheus]:::ext

  cli -->|HTTPS JWT| sys
  staff -->|HTTPS JWT + rol| sys
  ops -->|health / metrics| sys
  hw -->|evento canonico via adapter| sys
  sys -->|entrega firmada| wa
  sys -->|fetch allowlist| ds
  prom -->|scrape /health/metrics| sys

  classDef person fill:#08427b,color:#fff
  classDef sys fill:#1168bd,color:#fff
  classDef ext fill:#999,color:#fff
```

## Explicación

GymSheet gestiona entrenamientos, ejercicios, membresías, control de acceso físico/biometría y
notificaciones. Recibe eventos de acceso solo a través de un adapter (nunca del molinete directo,
ADR-0002) y envía notificaciones a un gateway externo. No ingiere datos por agentes de IA.

Siguiente nivel: [[02-architecture/views/c4-container]].
