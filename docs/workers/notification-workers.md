# Workers de recordatorios y mensajería

## Procesos

```text
membership-reminder.worker
notification-delivery.worker
```

Ambos son procesos persistentes separados del API. No se ejecutan con timers dentro del servidor HTTP.

## Recordatorios

El scheduler consulta membresías activas cuya diferencia entre `ends_on` y la fecha de negocio coincide con un umbral del plan. La creación de `notifications.messages` y `integration.outbox_jobs` ocurre en la misma transacción.

La clave de deduplicación incluye membresía, fecha de vencimiento, días restantes y canal. Ejecutar el scan varias veces no duplica mensajes.

## Entrega

El delivery worker reclama jobs con `FOR UPDATE SKIP LOCKED`, límite de lote, concurrencia acotada y lock recuperable. La semántica es al menos una vez; el adapter recibe una clave de idempotencia.

Proveedores:

- `IN_APP`: marca el mensaje como disponible en la bandeja del usuario.
- `HTTP_GATEWAY`: POST HTTPS firmado con HMAC SHA-256, timeout, host allowlist y rechazo de redirects.
- `MOCK`: simula aceptación sin enviar. Está prohibido cuando `NODE_ENV=production`.

## Retry y dead letter

Los fallos aplican backoff exponencial acotado. Al llegar a `max_attempts`, el job y la notificación pasan a dead-letter. Cada intento se registra sin persistir secretos ni el contenido de respuestas externas.

## Operación

```text
yarn worker:reminders:prod
yarn worker:notifications:prod
```

Se requiere una réplica mínima de cada proceso y supervisión del orquestador. `SIGTERM` y `SIGINT` detienen nuevos claims, esperan el lote actual y cierran el contexto Nest/PostgreSQL.

Métricas operativas mínimas:

- jobs pendientes por cola;
- edad del job más antiguo;
- entregas exitosas/fallidas;
- dead letters;
- duración del scan;
- recordatorios creados y duplicados evitados.
