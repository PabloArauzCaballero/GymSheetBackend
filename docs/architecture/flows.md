# Flujos principales

## Registro e inicio de sesión

1. El usuario se registra con email, contraseña y nombre completo.
2. La contraseña se hashea con bcrypt.
3. El sistema devuelve un JWT Bearer.
4. Las rutas privadas usan autenticación y roles globales.
5. La credencial física se gestiona en el dominio de acceso; el token web no abre el molinete.

## Entrenamiento

1. El usuario consulta ejercicios visibles.
2. Inicia una sesión.
3. Agrega ejercicios y series.
4. Finaliza o cancela la sesión.
5. Consulta o exporta historial paginado.

## Administración de instalaciones

```text
ADMIN
→ crea sede
→ crea sala dentro de sede
→ registra o actualiza máquina
→ asigna máquina a sala
→ registra punto de acceso y dispositivo
→ inactiva sin borrar historia
```

## Plan y membresía

```text
ADMIN/FRONT_DESK
→ crea o selecciona plan
→ asigna membresía al cliente
→ calcula startsOn y endsOn
→ registra estado ACTIVE
→ emite evento de dominio y outbox
```

El cliente puede consultar su plan vigente y los días restantes. No se infiere pago porque todavía no existe un módulo de cobros confirmado.

## Recordatorio de vencimiento

```text
worker scheduler
→ consulta membresías dentro de umbrales configurados
→ calcula días restantes en fecha de negocio
→ crea notificación y outbox con deduplication key
→ worker delivery reclama job
→ adapter IN_APP, HTTP firmado o MOCK
→ registra intento, resultado y próximo retry
→ completed o dead-letter
```

## Acceso físico

```text
dispositivo/adaptador
→ autentica credencial
→ envía evento canónico con sourceEventId
→ cola persistente reclama evento
→ valida usuario y credencial activos
→ si trabajador activo: acceso sin plan
→ si cliente: valida membresía y alcance
→ registra GRANTED o DENIED con reasonCode
→ adapter recibe decisión
```

Para PIN, el valor se verifica antes de encolar y nunca se persiste en el evento. Para rostro o huella solo se usa una referencia externa opaca.

## Simulación de hardware

```text
ADMIN en entorno no productivo
→ solicita simulación
→ servicio verifica PIN o referencia mock
→ encola evento sanitizado
→ worker mock procesa exactamente el contrato canónico
→ API permite consultar la decisión
```

`NODE_ENV=production` rechaza el simulador y el provider mock.

## Importación heredada

```text
archivo/export del sistema anterior
→ adapter específico
→ contrato canónico
→ staging
→ validación por registro
→ dry-run y reporte
→ reconciliación idempotente
→ tablas canónicas
```

Hasta recibir una muestra real solo se implementa el adapter mock y el contrato canónico. No se adivinan nombres de columnas del sistema anterior.

## Ciclo de vida de workers

```text
inicio
→ conectar DB
→ registrar processId
→ reclamar jobs con límite de concurrencia
→ procesar/reintentar
→ métricas y logs
→ SIGTERM/SIGINT
→ dejar de reclamar
→ finalizar trabajos en curso
→ cerrar DB
```
