---
title: "Supuestos y vacíos"
type: architecture
status: inferred
last_reviewed: "2026-08-06"
source_revision: "27f3fd2"
tags: [backend, architecture]
---

# Supuestos y vacíos

Supuestos documentados e información faltante que condiciona la arquitectura. Fuentes:
`docs/architecture/architecture.md`, ADR-0002, `.env.example`.

## Supuestos (INFERIDO salvo indicación)

- El **comando de arranque de la API** en contenedor es `node dist/main.js` (INFERIDO del `Dockerfile`
  y del patrón de los workers; el servicio `api` no fija `command` explícito en compose).
- **`docker-compose.dev.yml`** relaja endurecimiento y usa `NODE_ENV=development` con seeds `all`
  (INFERIDO de `startupSeedMode()`); no se leyó su contenido exacto en esta revisión.
- La **autenticación del adapter PACS** hacia el backend usa un canal autenticado; el mecanismo
  concreto no está fijado (ADR-0002 prefiere OSDP Secure Channel).

## Vacíos conocidos (del propio repo)

- **Fabricante y protocolo del molinete** desconocidos: solo existe un worker/adapter **mock**,
  bloqueado en producción.
- **Contrato del backend heredado** no entregado: la importación heredada implementa solo el adapter
  mock y el contrato canónico; no se adivinan columnas del sistema anterior.
- **Proveedor de mensajería externo** no definido a nivel de contrato (se soporta HTTP gateway
  genérico firmado).
- **Módulo de cobros/pagos** no confirmado: no se infiere pago desde la membresía.
- **Exportación PDF** fuera del alcance actual.

## Cómo se aíslan

Los faltantes se encapsulan tras **adapters y contratos canónicos**, no con condicionales dispersos,
para poder sustituir hardware/proveedor sin tocar el dominio. Ver
[[02-architecture/trust-boundaries]] y [[02-architecture/architecture-risks]] (ARCH-5).

## Limitaciones de esta documentación

Notas derivadas de lectura de código en la revisión `27f3fd2`; no se ejecutó el sistema como parte de
esta documentación. Estado de producción verificado: `BACKEND_AUDIT_HARDENING_AND_ACTION_PLAN.md`.
