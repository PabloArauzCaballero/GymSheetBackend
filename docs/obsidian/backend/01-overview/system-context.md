---
title: "Contexto del sistema (negocio)"
type: architecture
status: verified
last_reviewed: "2026-08-06"
source_revision: "27f3fd2"
tags: [backend, architecture]
---

# Contexto del sistema (negocio)

Visión de negocio de quién usa GymSheet y con qué sistemas se integra. Versión técnica con
protocolos: [[02-architecture/system-context]] y [[02-architecture/views/c4-context]].

```mermaid
flowchart TB
  socio[Socio]:::p
  staff[Personal / Admin]:::p
  ops[Operador]:::p
  gs[GymSheet]:::s
  pacs[Molinete PACS]:::e
  wa[WhatsApp gateway]:::e
  ds[Dataset ejercicios]:::e

  socio -->|entrena, ve su membresia| gs
  staff -->|gestiona socios, planes, sedes| gs
  ops -->|opera y monitorea| gs
  pacs -->|eventos de acceso| gs
  gs -->|recordatorios| wa
  gs -->|catalogo| ds

  classDef p fill:#08427b,color:#fff
  classDef s fill:#1168bd,color:#fff
  classDef e fill:#999,color:#fff
```

## Actores

- **Socio**: consulta y registra entrenamientos, ve su plan/membresía vigente y días restantes,
  gestiona su credencial de acceso.
- **Personal / Admin**: alta de socios y membresías, sedes/salas/equipamiento, mantenimiento,
  catálogo y credenciales.
- **Operador / SRE**: despliegue, health, métricas, runbooks.

## Sistemas externos

- **Molinete / PACS** (entrante vía adapter, ADR-0002).
- **Gateway de notificaciones** WhatsApp (saliente).
- **Dataset de ejercicios** externo (saliente, allowlist).
- **Prometheus** (scrape de métricas).

## Límites de alcance

Sin cobros confirmados, sin exportación PDF, sin plataforma de inteligencia económica, sin ingesta
por IA. Ver [[01-overview/assumptions-and-gaps]].
