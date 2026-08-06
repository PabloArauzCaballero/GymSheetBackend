---
title: "Glosario"
type: architecture
status: verified
last_reviewed: "2026-08-06"
source_revision: "27f3fd2"
tags: [backend, architecture]
aliases: [Glossary]
---

# Glosario

Términos del dominio y de la arquitectura. Detalle por dominio: [[03-domains/index]].

| Término | Definición |
|---|---|
| **Membresía** (membership) | Relación temporal de un socio con un plan; tiene `startsOn`/`endsOn`, estado (ACTIVE, etc.) e historial append-only. Agregado más grande (18 models). |
| **Entitlement** | Derecho concreto que otorga un plan/membresía (qué puede usar o dónde puede entrar el socio). Insumo de la decisión de acceso. |
| **Plan** | Producto de membresía con features asociadas; base para crear membresías. |
| **Intent** | Intención registrada de renovación o extensión de membresía antes de materializarse como cambio de estado. |
| **Outbox** | Cola de trabajo transaccional en PostgreSQL (`integration.outbox_jobs`). Se escribe en la misma tx que la mutación; los workers la reclaman. Mutable (representa entrega, no verdad histórica). ADR-0005. |
| **Domain event** | Registro append-only en `integration.domain_events` con nombre y versión (`membership.activated.v1`), actor, agregado y payload. Ledger histórico. |
| **Credential** | Medio de acceso de una persona (PIN hasheado o referencia biométrica opaca). No guarda templates biométricos (ADR-0002). |
| **Decision** | Resultado de evaluar una política de acceso ante un evento de dispositivo: GRANTED/DENIED con `reasonCode`. `GRANTED` ≠ paso físico confirmado. |
| **Routine** | Plantilla de entrenamiento (rutina) con ejercicios y asignaciones a socios. |
| **Session** | Sesión de entrenamiento ejecutada por un socio, compuesta de sets. |
| **AccessDeviceEvent** | Evento canónico emitido por el adapter PACS con `sourceEventId` único (idempotencia). |
| **Dead-letter** | Estado terminal de un job/evento tras agotar `WORKER_MAX_ATTEMPTS`. |
| **Lease / fencing** | Reserva temporal de un job por un worker (`locked_by` + `attempt_count` + timeout) que impide que un worker rezagado lo sobrescriba. |
| **At-least-once** | Garantía de entrega: un consumidor puede recibir el mismo trabajo más de una vez; debe ser idempotente. |

Ver [[01-overview/glossary]] enlazado desde [[00-home/index]].
