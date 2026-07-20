# Estado de hardening empresarial — GymSheet Backend

Fecha de corte: 2026-07-19  
Rama: `HARDENING`  
Estado de integración: pull request en borrador; no fusionar hasta cerrar todos los gates.

## Objetivo operacional

Extender el backend de entrenamiento para operar un gimnasio de gran escala con:

- sedes, salas y puntos de acceso;
- inventario y ciclo de vida de máquinas;
- clientes, personal, planes y membresías;
- entradas y salidas auditables;
- PIN y referencias externas de rostro/huella;
- recordatorios de vencimiento con días restantes;
- comandos transaccionales que escriben múltiples tablas;
- eventos append-only y outbox para efectos asíncronos;
- workers persistentes, reintentos, fencing y dead-letter;
- simulador de hardware deshabilitado en producción;
- staging canónico para absorber el backend heredado.

## Fases ejecutadas

### 1. Arquitectura, amenazas y límites

Estado: **implementada**.

- ADR del adapter de acceso físico.
- Modelo de amenazas.
- Contrato canónico independiente del fabricante.
- Prohibición de almacenar imágenes, huellas, plantillas, embeddings o minutiae.
- Separación entre API web, adapter, cola y política de acceso.

### 2. Modelo empresarial y migraciones

Estado: **implementada; requiere validación final en staging**.

Esquemas:

```text
facilities
membership
access_control
notifications
integration
training
app_meta
```

La cadena contiene siete migraciones reversibles. Incluye constraints, índices, historial de membresía, ledger append-only de eventos, enlace del outbox y conservación de las tablas heredadas del proyecto.

### 3. Sedes, salas y máquinas

Estado: **implementada mediante casos de uso, no CRUD genérico**.

- Sedes, salas y puntos de acceso con validaciones de pertenencia.
- Asignación histórica de máquinas a salas.
- La reasignación finaliza la fila anterior, crea la nueva y registra un evento en la misma transacción.
- Datos de fabricante, modelo, serie, activo, compra y garantía.
- Programación, inicio y cierre de mantenimiento.
- Inicio y cierre actualizan máquina, mantenimiento y evento de dominio atómicamente.

### 4. Clientes, personal, planes y membresías

Estado: **implementada con comandos multi-registro**.

El alta de cliente crea en una transacción:

```text
public.usuarios
membership.customer_profiles
access_control.credentials
notifications.preferences
integration.domain_events
```

Además:

- PIN obligatorio y almacenado únicamente como hash.
- Personal `ADMIN`, `COACH` y `FRONT_DESK` con múltiples alcances de sede.
- Alta de personal crea perfil, alcances y evento.
- Acceso ilimitado condicionado a relación laboral activa.
- Activar membresía crea membresía, historial inicial y evento.
- Cambiar estado bloquea la membresía, la actualiza y crea historial más evento.
- Días restantes calculados con fecha de negocio.

### 5. Arquitectura orientada a eventos

Estado: **implementada en los flujos críticos; consumidores adicionales deben añadirse solo cuando exista una necesidad real**.

- `integration.domain_events` conserva eventos append-only.
- Trigger PostgreSQL rechaza `UPDATE` y `DELETE`.
- Eventos versionados y deduplicados.
- Actor, correlation, causation y trace disponibles.
- Outbox separado del ledger histórico.
- El outbox se crea en la misma transacción que el mensaje y el evento.
- No se afirma exactly-once; se usa at-least-once con consumidores idempotentes.
- Catálogo inicial documentado en `docs/architecture/event-driven-production-audit.md`.

### 6. Control de acceso

Estado: **implementada con adapter real pendiente de homologación**.

- Dispositivos y eventos idempotentes.
- Worker persistente con `FOR UPDATE SKIP LOCKED`.
- Política determinista y versionada.
- Decisión, evento de dominio y finalización del trabajo ocurren en la misma transacción.
- Una decisión ya existente finaliza el evento sin duplicarla.
- Fencing por propietario del lock y número de intento.
- Decisiones `GRANTED`/`DENIED` con códigos estables.
- PIN con bcrypt y biometría solo mediante referencias opacas.
- Simulador administrativo solo en entornos no productivos.
- `GRANTED` significa autorización; no afirma paso físico confirmado.

### 7. Mensajería y vencimientos

Estado: **implementada; proveedor externo pendiente de configuración contractual**.

- Bandeja in-app.
- Preferencias, consentimiento y fallback seguro a `IN_APP`.
- Horas de silencio aplicadas a `outbox.available_at`.
- Mensajes con días restantes y fecha de vencimiento.
- Mensaje, evento y outbox creados atómicamente.
- Worker de escaneo y worker de entrega.
- Backoff, idempotencia, intentos, dead-letter y adapter HTTP firmado.
- Fencing al completar o fallar trabajos.
- Provider `MOCK` prohibido en producción.

### 8. Absorción del backend anterior

Estado: **staging y dry-run implementados; aplicación definitiva bloqueada por falta del export real**.

- Contrato canónico para clientes, planes, membresías, personal y accesos históricos.
- Hasta 5.000 registros y 5 MiB por lote.
- SHA-256 estable del lote y de cada registro.
- Idempotencia por sistema/lote externo.
- Validación registro por registro y reporte paginado.
- Rechazo de secretos, PIN y material biométrico.
- Ninguna escritura en tablas operativas durante dry-run.

## Evidencia automatizada

El pipeline ejecuta:

```text
yarn install --frozen-lockfile
yarn audit --groups dependencies
yarn type-check
yarn test
yarn build
PostgreSQL 16 baseline
siete migraciones up/down/up
backup y restore
verificación del ledger y del historial
smoke HTTP con carga acotada
```

La ejecución verde debe corresponder al último commit de la rama. Cualquier cambio posterior invalida la evidencia previa hasta que GitHub Actions vuelva a completarse.

## Gates todavía obligatorios

No aprobar producción hasta completar:

1. CI verde sobre el commit final del pull request.
2. Migraciones contra una copia anonimizada del backend actual del cliente.
3. Pruebas e2e de onboarding, membresía, vencimiento y acceso.
4. Pruebas de concurrencia con varias réplicas de workers.
5. Export real y diccionario de datos del backend anterior.
6. Fabricante, modelo, protocolo, autenticación y operación offline del molinete.
7. Revisión contractual/legal del tratamiento biométrico y consentimiento.
8. Rotación de secretos históricamente expuestos y purga coordinada del historial.
9. Proveedor real de mensajería, destino de usuario, SLA y política de opt-out.
10. Ensayo de backup, restore, rollback y despliegue canario.
11. Dashboards y alertas para colas, dead-letter, accesos denegados y workers caídos.
12. Prueba de aceptación con recepción, coaches, administración y soporte.

## Decisión de despliegue

La rama ya no depende de CRUD genérico para los flujos operativos críticos. Aun así, el despliegue productivo permanece bloqueado hasta que los gates externos tengan evidencia verificable y aprobación del cliente.
