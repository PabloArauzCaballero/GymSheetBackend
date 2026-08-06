---
type: data
status: verified
last_reviewed: 2026-08-06
source_revision: 27f3fd2
tags: [backend, data]
---

# Modelo entidad-relación (ERD global)

ERD global simplificado del backend. Por legibilidad, los tipos físicos y las columnas se omiten;
`USUARIO` es el hub central. Los ERDs de detalle por dominio están en [[conceptual-data-model]].

```mermaid
erDiagram
    USUARIO ||--o| PERFIL_ANTROPOMETRICO : ""
    USUARIO ||--o| ONBOARDING : ""
    USUARIO ||--o| PERFIL_CLIENTE : ""
    USUARIO ||--o| PERFIL_STAFF : ""
    USUARIO ||--o| PREFERENCIA_NOTIF : ""
    USUARIO ||--o{ MEDICION_CORPORAL : ""
    USUARIO ||--o{ MEMBRESIA : ""
    USUARIO ||--o{ DERECHO : ""
    USUARIO ||--o{ CREDENCIAL : ""
    USUARIO ||--o{ NOTIFICACION : ""
    USUARIO ||--o{ INTENT : ""
    USUARIO ||--o{ RUTINA : ""
    USUARIO ||--o{ ASIGNACION_RUTINA : ""
    USUARIO ||--o{ SESION : ""

    PLAN ||--o{ MEMBRESIA : ""
    PLAN ||--o{ PLAN_FEATURE : ""
    PLAN ||--o{ PLAN_SCOPE : ""
    PLAN ||--o{ INTENT : ""
    FEATURE ||--o{ PLAN_FEATURE : ""
    FEATURE ||--o{ DERECHO : ""
    MEMBRESIA ||--o{ HISTORIAL_ESTADO : ""
    MEMBRESIA ||--o{ EXTENSION : ""
    MEMBRESIA ||--o{ DECISION : ""
    MEMBRESIA ||--o{ NOTIFICACION : ""
    INTENT ||--o| EXTENSION : ""
    PERFIL_STAFF ||--o{ STAFF_SCOPE : ""

    CREDENCIAL ||--o{ EVENTO_DISPOSITIVO : ""
    DISPOSITIVO ||--o{ EVENTO_DISPOSITIVO : ""
    EVENTO_DISPOSITIVO ||--|| DECISION : ""
    SUCURSAL ||--o{ SALA : ""
    SALA ||--o{ PUNTO_ACCESO : ""
    PUNTO_ACCESO ||--o{ DISPOSITIVO : ""
    PLAN_SCOPE }o--|| SUCURSAL : ""
    STAFF_SCOPE }o--|| SUCURSAL : ""

    EQUIPO ||--o{ ASIGNACION_EQUIPO : ""
    SALA ||--o{ ASIGNACION_EQUIPO : ""
    EQUIPO ||--o{ MANTENIMIENTO : ""
    EQUIPO ||--o{ EJERCICIO_EQUIPO : ""

    EJERCICIO ||--o{ EJERCICIO_EQUIPO : ""
    EJERCICIO ||--o{ RUTINA_EJERCICIO : ""
    EJERCICIO ||--o{ MEDIA_EJERCICIO : ""
    RUTINA ||--o{ RUTINA_EJERCICIO : ""
    RUTINA ||--o{ ASIGNACION_RUTINA : ""
    RUTINA ||--o{ SESION : ""
    SESION ||--o{ SESION_EJERCICIO : ""
    EJERCICIO ||--o{ SESION_EJERCICIO : ""
    SESION_EJERCICIO ||--o{ SERIE : ""

    NOTIFICACION ||--o{ INTENTO_ENTREGA : ""
    DOMAIN_EVENT ||--o{ OUTBOX_JOB : ""
    DOMAIN_EVENT ||--o| HISTORIAL_ESTADO : ""
    IMPORT_BATCH ||--o{ IMPORT_RECORD : ""
```

## Lectura

- **`USUARIO`** concentra la mayoría de relaciones (identidad, membresías, acceso, entrenamiento,
  notificaciones). Es el principal punto de re-validación de autorización.
- **`MEMBRESIA`** es el eje del negocio: nace de un `PLAN`, evoluciona por `HISTORIAL_ESTADO` y
  `EXTENSION`, y habilita `DECISION` de acceso y `NOTIFICACION`.
- **`DOMAIN_EVENT`** es la espina dorsal de la mensajería: alimenta `OUTBOX_JOB` (entrega asíncrona) y
  respalda cada `HISTORIAL_ESTADO`.
- **`EVENTO_DISPOSITIVO` → `DECISION`** es 1:1 (una decisión por evento).

> [!note] Hay ERDs por dominio
> Diagramas más específicos y con atributos viven en [[conceptual-data-model]] (núcleo, entrenamiento,
> instalaciones/notificaciones) y en las notas de dominio [[03-domains/membership/index|Membership]],
> [[03-domains/access-control/index|Access Control]], [[03-domains/training/index|Training]].

## Referencias

- Catálogo tabular de relaciones con ON DELETE: [[relationship-catalog]]
- Modelo físico: [[physical-data-model]]
