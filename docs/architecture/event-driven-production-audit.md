# Auditoría de arquitectura orientada a eventos

Fecha: 2026-07-19  
Rama: `HARDENING`

## Dictamen

La implementación previa contiene piezas correctas —transacciones Sequelize, outbox para notificaciones, workers persistentes, `SKIP LOCKED`, reintentos y deduplicación—, pero todavía no constituye una arquitectura orientada a eventos integral.

El problema principal es que varios endpoints siguen modelados como mutaciones CRUD aisladas. En un sistema operativo de gimnasio, una orden de negocio debe coordinar de forma atómica todas las escrituras obligatorias y después publicar únicamente los efectos secundarios que puedan ser asíncronos.

## Hallazgos críticos

1. `integration.outbox_jobs` combina dos responsabilidades: registro del evento de negocio y estado mutable de entrega. Falta un ledger inmutable de eventos separado de la cola.
2. Las operaciones de cliente, membresía, personal, máquinas y mantenimiento no registran eventos de dominio.
3. Las membresías no conservan historial estructurado de cambios de estado; únicamente se actualiza la fila actual.
4. La rama contiene una implementación de alta de cliente con PIN en `CustomerStaffService`, pero el módulo y `MembershipService` todavía ejecutan la versión anterior sin crear la credencial. La funcionalidad quedó parcialmente integrada.
5. El alta de cliente debe crear, en una sola transacción, usuario, perfil de cliente, credencial PIN, preferencia de notificaciones y evento de dominio.
6. La activación de una membresía debe crear membresía, historial inicial y evento de dominio en una sola transacción.
7. Un cambio de estado debe actualizar la membresía, insertar historial y registrar el evento correspondiente de forma atómica.
8. La asignación de una máquina debe cerrar la asignación anterior, crear la nueva y registrar un evento.
9. Iniciar o completar mantenimiento debe cambiar equipo y mantenimiento en la misma transacción y registrar el evento.
10. El procesamiento de acceso crea decisión y actualiza el evento, pero si ya existe la decisión retorna antes de completar la fila de cola. Esto puede dejar eventos reintentándose indefinidamente.
11. Los workers no aplican fencing por propietario del lock al completar o fallar un trabajo. Un worker atrasado podría sobrescribir el estado de un trabajo reclamado nuevamente.
12. Un error transitorio durante `claim` puede finalizar el loop del worker.
13. `sleep` deja listeners de aborto registrados cuando el temporizador finaliza normalmente, produciendo crecimiento de listeners en procesos de larga duración.
14. Las horas de silencio están almacenadas pero no influyen en `available_at`.
15. La selección del canal externo debe validar nuevamente consentimiento en la consulta, aunque existan constraints y validación Zod.
16. El evento actual del molinete representa una solicitud autenticada. No debe confundirse una decisión `GRANTED` con confirmación física de paso; la futura integración debe aportar un evento canónico separado de paso confirmado.

## Diseño objetivo

```text
Comando de negocio
  -> transacción PostgreSQL
       -> mutaciones canónicas del agregado
       -> historial específico del dominio
       -> evento inmutable en integration.domain_events
       -> outbox únicamente para consumidores asíncronos concretos
  -> commit
  -> worker con entrega al menos una vez
  -> consumidor idempotente
```

## Principios obligatorios

- Consistencia fuerte dentro del límite transaccional.
- Eventual consistency solo para efectos secundarios.
- Evento y mutación escritos en la misma transacción.
- Eventos con nombre y versión explícitos.
- Correlation, causation, actor y trace cuando estén disponibles.
- Outbox mutable separado del evento inmutable.
- Consumidores idempotentes.
- Locks con propietario y número de intento como fencing token.
- No afirmar exactly-once.
- No crear un bus genérico que oculte reglas de negocio.
- Cada caso de uso debe expresar explícitamente qué tablas modifica.

## Eventos iniciales del dominio

- `customer.registered.v1`
- `staff.profile-created.v1`
- `staff.employment-status-changed.v1`
- `membership.activated.v1`
- `membership.status-changed.v1`
- `equipment.assigned-to-room.v1`
- `equipment.maintenance-started.v1`
- `equipment.maintenance-completed.v1`
- `access.decision-recorded.v1`
- `notification.delivery-requested.v1`

## Límite del hardware

El backend no inventará el protocolo del molinete. La integración futura debe distinguir al menos:

1. credencial presentada;
2. decisión de autorización;
3. orden de apertura enviada;
4. confirmación o fallo del dispositivo;
5. paso físico confirmado, cuando el hardware lo soporte.

Hasta recibir la documentación del fabricante, el mock solo debe probar contratos canónicos y no afirmar una confirmación física inexistente.
