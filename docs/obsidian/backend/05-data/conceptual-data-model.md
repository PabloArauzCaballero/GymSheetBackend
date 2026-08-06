---
type: data
status: verified
last_reviewed: 2026-08-06
source_revision: 27f3fd2
tags: [backend, data]
---

# Modelo conceptual de datos

Entidades de negocio y relaciones principales, sin tipos físicos ni claves. Simplificado por dominio.

## Núcleo: personas, membresías y acceso

```mermaid
erDiagram
    USUARIO ||--o| PERFIL_ANTROPOMETRICO : tiene
    USUARIO ||--o| PERFIL_CLIENTE : tiene
    USUARIO ||--o| PERFIL_STAFF : tiene
    USUARIO ||--o{ MEMBRESIA : posee
    PLAN ||--o{ MEMBRESIA : define
    PLAN ||--o{ CARACTERISTICA_PLAN : agrupa
    CARACTERISTICA ||--o{ CARACTERISTICA_PLAN : incluida_en
    USUARIO ||--o{ DERECHO : habilita
    CARACTERISTICA ||--o{ DERECHO : otorga
    MEMBRESIA ||--o{ HISTORIAL_ESTADO : registra
    USUARIO ||--o{ CREDENCIAL_ACCESO : registra
    CREDENCIAL_ACCESO ||--o{ EVENTO_DISPOSITIVO : genera
    EVENTO_DISPOSITIVO ||--|| DECISION_ACCESO : resuelve
    MEMBRESIA ||--o{ DECISION_ACCESO : justifica
```

Un **usuario** puede ser cliente, staff o ambos. Compra **membresías** de un **plan**; el plan
concede **características** que se materializan como **derechos** (entitlements) del usuario. El acceso
físico se registra con **credenciales** que generan **eventos de dispositivo**, cada uno resuelto en
una **decisión de acceso**.

## Entrenamiento

```mermaid
erDiagram
    USUARIO ||--o{ RUTINA : crea
    RUTINA ||--o{ RUTINA_EJERCICIO : contiene
    EJERCICIO ||--o{ RUTINA_EJERCICIO : prescrito_en
    RUTINA ||--o{ ASIGNACION_RUTINA : asignada
    USUARIO ||--o{ ASIGNACION_RUTINA : recibe
    USUARIO ||--o{ SESION_ENTRENAMIENTO : ejecuta
    RUTINA ||--o{ SESION_ENTRENAMIENTO : origina
    SESION_ENTRENAMIENTO ||--o{ SESION_EJERCICIO : compone
    EJERCICIO ||--o{ SESION_EJERCICIO : usado_en
    SESION_EJERCICIO ||--o{ SERIE : registra
    EJERCICIO ||--o{ EJERCICIO_EQUIPO : requiere
    EQUIPO ||--o{ EJERCICIO_EQUIPO : usado_por
```

Un **coach** crea **rutinas** con **ejercicios** prescritos y las **asigna** a clientes. La ejecución
real vive en **sesiones** con sus **ejercicios** y **series** (peso, reps, RIR).

## Instalaciones y notificaciones

```mermaid
erDiagram
    SUCURSAL ||--o{ SALA : contiene
    SALA ||--o{ PUNTO_ACCESO : ubica
    SUCURSAL ||--o{ PUNTO_ACCESO : pertenece
    EQUIPO ||--o{ ASIGNACION_EQUIPO : ubicado
    SALA ||--o{ ASIGNACION_EQUIPO : aloja
    EQUIPO ||--o{ EVENTO_MANTENIMIENTO : mantiene
    USUARIO ||--o| PREFERENCIA_NOTIFICACION : configura
    USUARIO ||--o{ NOTIFICACION : recibe
    MEMBRESIA ||--o{ NOTIFICACION : motiva
    NOTIFICACION ||--o{ INTENTO_ENTREGA : entrega
```

Las **sucursales** contienen **salas** y **puntos de acceso**; los **equipos** se asignan a salas y
tienen **mantenimientos**. Las **notificaciones** (recordatorios de expiración) se envían al usuario y
registran **intentos de entrega**.

## Notas

- ERD global unificado y por dominio: [[entity-relationship-model]].
- Diagramas de dominio de negocio: ver [[03-domains/membership/index|Membership]],
  [[03-domains/access-control/index|Access Control]], [[03-domains/training/index|Training]].
