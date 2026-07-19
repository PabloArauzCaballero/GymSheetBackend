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
- workers persistentes, reintentos y dead-letter;
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

Esquemas nuevos:

```text
facilities
membership
access_control
notifications
integration
training
app_meta
```

Incluye migraciones reversibles, registro de versiones, constraints, índices parciales y conservación de tablas heredadas del proyecto.

### 3. Sedes, salas y máquinas

Estado: **implementada**.

- CRUD de sedes y salas.
- Puntos de acceso por sede/sala y dirección permitida.
- Asignación histórica de máquinas a salas.
- Datos de fabricante, modelo, serie, activo, compra y garantía.
- Mantenimiento programado, en progreso y completado.
- Próxima fecha de servicio y estado operativo.

### 4. Clientes, personal, planes y membresías

Estado: **implementada**.

- Tipos de planes y duración configurable.
- Alcance por sede o sala.
- Umbrales de recordatorio por plan.
- Alta transaccional de usuario, cliente y PIN.
- Personal `ADMIN`, `COACH` y `FRONT_DESK` con alcance de sede.
- Acceso ilimitado condicionado a relación laboral activa.
- Membresías con inicio, fin, suspensión, cancelación y días restantes.

### 5. Control de acceso

Estado: **implementada con adapter real pendiente de homologación**.

- Dispositivos y eventos idempotentes.
- Worker persistente con `FOR UPDATE SKIP LOCKED`.
- Política determinista y versionada.
- Decisiones `GRANTED`/`DENIED` con códigos estables.
- Historial del usuario y vista administrativa.
- PIN con hash bcrypt.
- Referencias opacas externas para rostro/huella con consentimiento.
- Simulador administrativo solo en entornos no productivos.

### 6. Mensajería y vencimientos

Estado: **implementada; proveedor externo pendiente de configuración contractual**.

- Bandeja in-app.
- Preferencias y consentimiento para canal externo.
- Cálculo por fecha de negocio `America/La_Paz`.
- Mensajes que incluyen días restantes y fecha de vencimiento.
- Outbox transaccional.
- Worker de escaneo y worker de entrega.
- Backoff, idempotencia, intentos, dead-letter y adapter HTTP firmado.
- Provider `MOCK` prohibido en producción.

### 7. Absorción del backend anterior

Estado: **staging y dry-run implementados; aplicación definitiva bloqueada por falta del export real**.

- Contrato canónico para clientes, planes, membresías, personal y accesos históricos.
- Hasta 5.000 registros y 5 MiB por lote.
- SHA-256 estable del lote y de cada registro.
- Idempotencia por sistema/lote externo.
- Validación registro por registro y reporte paginado.
- Rechazo de secretos, PIN y material biométrico.
- Ninguna escritura en tablas operativas durante dry-run.

## Evidencia automatizada disponible

El pipeline de la rama ejecuta:

```text
yarn install --frozen-lockfile
yarn audit --groups dependencies
yarn type-check
yarn test
yarn build
PostgreSQL 16 baseline
migration up/down/up
backup y restore
smoke HTTP con carga acotada
```

La evidencia se conserva como artefacto temporal de GitHub Actions. Un resultado anterior detectó correctamente un error en la prueba de rollback al crecer de una a seis migraciones; el workflow fue corregido para verificar la cadena completa.

## Gates todavía obligatorios

No aprobar producción hasta completar:

1. CI verde sobre el commit final del pull request.
2. Migraciones contra una copia anonimizada del backend actual del cliente.
3. Pruebas e2e de onboarding, plan, vencimiento y acceso.
4. Pruebas de concurrencia con varios workers.
5. Export real y diccionario de datos del backend anterior.
6. Fabricante, modelo, protocolo, autenticación y operación offline del molinete.
7. Revisión contractual/legal del tratamiento biométrico y consentimiento.
8. Rotación de secretos históricamente expuestos y purga coordinada del historial.
9. Proveedor real de mensajería, destino de usuario, SLA y política de opt-out.
10. Ensayo de backup, restore, rollback y plan de despliegue canario.
11. Dashboards y alertas para colas, dead-letter, accesos denegados y workers caídos.
12. Prueba de aceptación con recepción, coaches, administración y soporte.

## Decisión de despliegue

El código de la rama es una base empresarial en endurecimiento. El despliegue productivo permanece deliberadamente bloqueado hasta que todos los gates anteriores tengan evidencia verificable y aprobación del cliente.
