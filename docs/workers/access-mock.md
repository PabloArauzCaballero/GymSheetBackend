# Simulador del adapter de acceso

## Objetivo

Permitir pruebas de punta a punta antes de recibir el protocolo y SDK del molinete. El simulador no intenta imitar un fabricante; produce el contrato canónico que también deberá producir el adapter real.

## Activación

```text
ACCESS_MOCK_ENABLED=true
```

La validación de entorno rechaza esta opción cuando `NODE_ENV=production`.

Endpoint:

```text
POST /api/v1/admin/access/mock/events
```

Solo `ADMIN` puede usarlo. El body contiene `dispositivoId`, `credencialId`, `direccion` y opcionalmente un identificador/timestamp del evento. No acepta material secreto o biométrico.

## Ejecución completa

```text
simulador
→ device_events PENDING
→ access-event.worker
→ política de autorización
→ decisions GRANTED o DENIED
→ consulta administrativa del evento
```

Para probar idempotencia, reutilice el mismo `eventoOrigenId`; el backend devolverá el evento ya registrado en lugar de duplicarlo.
