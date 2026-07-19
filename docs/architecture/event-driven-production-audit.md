# Auditoría de arquitectura orientada a eventos

Fecha: 2026-07-19  
Rama: `HARDENING`

## Dictamen

La implementación previa tenía piezas correctas —transacciones Sequelize, outbox para notificaciones, workers persistentes, `SKIP LOCKED`, reintentos y deduplicación—, pero varios endpoints todavía operaban como mutaciones CRUD aisladas.

La corrección aplicada cambia el centro del diseño: un comando de negocio coordina todas las escrituras obligatorias dentro de una sola transacción PostgreSQL, registra un evento de dominio append-only y crea outbox únicamente cuando existe un consumidor asíncrono concreto.

## Diseño aplicado

```text
Comando de negocio
  -> transacción PostgreSQL
       -> mutaciones canónicas del agregado
       -> historial específico del dominio
       -> evento append-only en integration.domain_events
       -> outbox para consumidores asíncronos concretos
  -> commit
  -> worker con entrega al menos una vez
  -> consumidor idempotente
```

No se afirma `exactly-once`. La entrega es `at-least-once`, con claves de deduplicación, consumidor idempotente y fencing por propietario del lock más número de intento.

## Matriz de comandos y registros generados

### Alta de cliente

Una sola transacción crea:

1. `public.usuarios`;
2. `membership.customer_profiles`;
3. `access_control.credentials` con PIN hasheado;
4. `notifications.preferences` con defaults seguros;
5. `integration.domain_events` con `customer.registered.v1`.

Si cualquiera de las cinco escrituras falla, ninguna queda confirmada.

### Alta de personal

Una sola transacción crea:

1. `membership.staff_profiles`;
2. una o varias filas en `membership.staff_branch_scopes`;
3. `integration.domain_events` con `staff.profile-created.v1`.

Un cambio laboral actualiza el perfil y registra `staff.employment-status-changed.v1` en la misma transacción.

### Activación de membresía

Una sola transacción crea:

1. `membership.memberships`;
2. `integration.domain_events` con `membership.activated.v1`;
3. `membership.status_history` con el estado inicial.

### Cambio de estado de membresía

Una sola transacción:

1. bloquea la membresía;
2. valida la transición;
3. actualiza `membership.memberships`;
4. inserta `membership.status_history`;
5. registra `membership.status-changed.v1`.

Repetir el mismo estado no genera historial artificial.

### Asignación de máquina a sala

Una sola transacción:

1. bloquea la asignación activa;
2. finaliza la asignación anterior cuando existe;
3. crea la nueva fila en `facilities.equipment_assignments`;
4. registra `equipment.assigned-to-room.v1`.

### Mantenimiento

Programar crea el mantenimiento y `equipment.maintenance-scheduled.v1`.

Iniciar actualiza en una sola transacción:

1. `equipos_gym` a mantenimiento;
2. `facilities.maintenance_events` a `IN_PROGRESS`;
3. `integration.domain_events` con `equipment.maintenance-started.v1`.

Completar actualiza en una sola transacción:

1. estado y próxima fecha de servicio de `equipos_gym`;
2. resultado, coste y estado de `facilities.maintenance_events`;
3. `integration.domain_events` con `equipment.maintenance-completed.v1`.

### Decisión de acceso

El worker, dentro de una sola transacción:

1. bloquea `access_control.device_events`;
2. verifica el lease del worker;
3. evalúa la política versionada;
4. crea `access_control.decisions`;
5. registra `access.decision-recorded.v1`;
6. finaliza el evento reclamado.

Si la decisión ya existe, el worker completa correctamente el evento pendiente sin duplicarla.

### Recordatorio de vencimiento

Una sola transacción crea:

1. `notifications.messages`;
2. `integration.domain_events` con `notification.delivery-requested.v1`;
3. `integration.outbox_jobs` enlazado al evento de dominio.

El worker de entrega crea después una fila en `notifications.delivery_attempts` y actualiza el mensaje. Las horas de silencio modifican `available_at`, y el canal externo vuelve a validar que exista consentimiento.

## Ledger, historial y outbox

`integration.domain_events` y `membership.status_history` son append-only mediante triggers PostgreSQL. El ledger conserva:

- nombres versionados;
- agregado y actor;
- correlation, causation y trace opcionales;
- payload y metadata JSON objeto;
- deduplicación única.

`integration.outbox_jobs` es mutable porque representa entrega, no verdad histórica. Cada job puede enlazarse con `domain_event_id`.

## Correcciones de concurrencia y workers

- claim atómico con `FOR UPDATE SKIP LOCKED`;
- recuperación de leases expirados;
- fencing por `locked_by` y `attempt_count` al completar o fallar;
- stale workers no pueden sobrescribir un job reclamado nuevamente;
- backoff y dead-letter;
- errores de polling no terminan el proceso persistente;
- listeners de aborto se retiran al finalizar cada espera;
- adapters externos reciben clave de idempotencia.

## Principios obligatorios

- Consistencia fuerte dentro del límite transaccional.
- Eventual consistency solo para efectos secundarios.
- Evento y mutación escritos en la misma transacción.
- Eventos con nombre y versión explícitos.
- Outbox mutable separado del evento histórico.
- Consumidores idempotentes.
- No crear un bus genérico que oculte reglas de negocio.
- Cada caso de uso debe expresar qué tablas modifica.
- No almacenar PIN, imágenes faciales, huellas ni templates biométricos en eventos.

## Catálogo inicial

- `customer.registered.v1`
- `staff.profile-created.v1`
- `staff.employment-status-changed.v1`
- `membership.activated.v1`
- `membership.status-changed.v1`
- `equipment.assigned-to-room.v1`
- `equipment.maintenance-scheduled.v1`
- `equipment.maintenance-started.v1`
- `equipment.maintenance-completed.v1`
- `access.decision-recorded.v1`
- `notification.delivery-requested.v1`

## Límite del hardware

El backend no inventa el protocolo del molinete. La integración futura debe distinguir:

1. credencial presentada;
2. decisión de autorización;
3. orden de apertura enviada;
4. confirmación o fallo del dispositivo;
5. paso físico confirmado, cuando el hardware lo soporte.

Una decisión `GRANTED` no equivale a paso físico confirmado. El mock prueba el contrato canónico, las transacciones y la idempotencia; no simula capacidades no documentadas por el fabricante.
