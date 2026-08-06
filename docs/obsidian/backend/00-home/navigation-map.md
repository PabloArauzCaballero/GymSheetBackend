---
title: "Mapa de navegación"
type: overview
status: verified
last_reviewed: "2026-08-06"
tags: [backend, documentation, navigation]
---

# Mapa de navegación

```mermaid
flowchart TD
    Home[[00-home/index]] --> Ov[01-overview]
    Home --> Arch[02-architecture]
    Home --> Dom[03-domains]
    Home --> Api[04-api]
    Home --> Data[05-data]
    Home --> Integ[06-integrations]
    Home --> Async[07-async-processing]
    Home --> Sec[08-security]
    Home --> Obs[09-observability]
    Home --> Ops[10-operations]
    Home --> Ref[15-reference]
    Home --> Aud[14-audits]
```

## Secciones

- [[01-overview/technology-stack]] · [[01-overview/repository-map]]
- [[02-architecture/architecture-overview]] · [[02-architecture/data-flow]] · [[02-architecture/critical-sequences]]
- [[03-domains/index]] — 15 módulos
- [[04-api/index]] — contratos REST, auth, errores
- [[05-data/data-architecture]] — modelo conceptual/lógico/físico, ERD, diccionario
- [[06-integrations/index]] — gateway notificaciones, dataset ejercicios
- [[07-async-processing/workers]] · [[07-async-processing/events]] — outbox
- [[08-security/security-overview]] · [[08-security/threat-model]]
- [[09-observability/observability-overview]]
- [[10-operations/deployment]] · [[10-operations/runbooks/index]]
- [[15-reference/environment-variables]] · [[15-reference/commands]] · [[15-reference/ports]]
- [[14-audits/risks-register]] · [[14-audits/documentation-coverage]]
