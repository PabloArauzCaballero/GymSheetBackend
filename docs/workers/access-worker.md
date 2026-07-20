# Worker de eventos de acceso

## Responsabilidad

`access-event.worker` procesa eventos canónicos ya autenticados por un adapter de control físico. No recibe PIN, imágenes, huellas, plantillas biométricas ni payloads propietarios.

Contrato de entrada persistido:

```text
deviceId
credentialId
sourceEventId
direction
occurredAt
metadata no sensible
```

## Concurrencia e idempotencia

El worker reclama lotes con `FOR UPDATE SKIP LOCKED`, concurrencia acotada y recuperación de locks abandonados. La restricción `(device_id, source_event_id)` deduplica el evento y `device_event_id UNIQUE` garantiza una sola decisión.

La semántica es al menos una vez. Reprocesar un evento cuya decisión ya existe devuelve esa decisión sin crear otra.

## Política

La decisión verifica estado actual de:

- usuario;
- credencial;
- dispositivo y dirección del punto de acceso;
- relación laboral y alcance de sede;
- plan, membresía y alcance de sede o sala.

El personal activo con acceso ilimitado no necesita una membresía. Un trabajador suspendido o terminado deja de obtener ese beneficio.

## Fallos

Los fallos aplican backoff exponencial acotado. Al alcanzar `WORKER_MAX_ATTEMPTS`, el evento pasa a `DEAD_LETTER`. El error guardado está truncado y no incluye secretos ni material de autenticación.

## Ejecución

```text
yarn worker:access
yarn worker:access:prod
```

El proceso atiende `SIGTERM` y `SIGINT`, deja de reclamar trabajo, termina el lote en curso y cierra el contexto de Nest/PostgreSQL.
