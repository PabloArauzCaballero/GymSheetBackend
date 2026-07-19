# Plan incremental de expansión GymSheet Enterprise

Fecha: 2026-07-19  
Rama: `HARDENING`  
Cambio de alcance: administración operativa de gimnasio, membresías, acceso físico, notificaciones, workers mock e importación heredada.

## Estado inicial

```text
Fase actual: 1 de 8
Fases completadas: 0
Fases restantes: 8
Objetivo: validar fuentes, contradicciones, riesgos y dependencias antes de tocar contratos o datos.
Gate de entrada: aprobado
Gate de salida: pendiente
```

## Hechos verificados

- El backend vigente es un monolito modular NestJS, Sequelize y PostgreSQL.
- Ya existen usuarios, perfiles, equipos, ejercicios, sesiones y exportaciones.
- No existe `domainModel.puml`; los diagramas actuales cubren el alcance original de entrenamiento.
- El nuevo alcance exige planes, membresías, clientes, trabajadores, salas, máquinas, entradas/salidas, credenciales físicas y recordatorios.
- El hardware del molinete todavía no tiene protocolo, fabricante ni contrato confirmado.
- El backend heredado todavía no tiene un contrato o export verificable.

## Decisiones de seguridad

1. El API web no controla directamente el molinete.
2. El núcleo recibe eventos canónicos mediante un adapter; el mock usa el mismo contrato.
3. No se almacenan imágenes faciales, huellas ni plantillas biométricas en este backend.
4. Solo se almacenan referencias opacas del proveedor, consentimiento, estado y auditoría.
5. El PIN de acceso se almacena únicamente como hash y nunca en jobs, logs o respuestas recurrentes.
6. Todo evento de dispositivo requiere identidad externa única e idempotencia.
7. Las decisiones de acceso se registran aun cuando son denegadas.
8. El personal tiene acceso sin plan solo mientras su relación laboral está activa.
9. Los recordatorios usan outbox transaccional y workers separados del API.
10. Los mocks están prohibidos en producción.

## Fases y gates

### Fase 1 — Descubrimiento, arquitectura y amenazas

Entregables:

- este plan;
- ADR de frontera PACS/biometría;
- threat model;
- actualización del PR a borrador.

Gate:

- alcance y desconocidos documentados;
- no se inventa protocolo del hardware ni formato del legado.

### Fase 2 — Modelo de datos y migración

Dominios:

```text
facilities
membership
access_control
notifications
integration
```

Entregables:

- migración reversible;
- modelos Sequelize;
- constraints, índices y retención explícita;
- registro de modelos.

Gate:

- migración up/down/reapply en PostgreSQL 16;
- ningún objeto nuevo en `public`.

### Fase 3 — Persistencia y reglas de negocio

Entregables:

- repositories y services para sedes, salas, máquinas, planes, membresías y personal;
- cálculo consistente de días restantes;
- motor de autorización de acceso;
- idempotencia de eventos.

Gate:

- pruebas de membresía activa, vencida, futura, suspendida y personal activo/inactivo;
- ownership y roles negativos.

### Fase 4 — API administrativa y contratos

Entregables:

- endpoints administrativos y de consulta del cliente;
- Zod, DTOs y mappers;
- OpenAPI y endpoints.md.

Gate:

- compatibilidad v1 preservada;
- UUID, paginación, filtros y RBAC verificados.

### Fase 5 — Workers y mensajería

Entregables:

- worker persistente de recordatorios;
- worker persistente de entrega;
- adapter HTTP firmado y adapter mock no productivo;
- outbox, retry, dead-letter e idempotencia.

Gate:

- shutdown, concurrencia, retry y deduplicación probados;
- mock rechazado en producción.

### Fase 6 — Worker mock de hardware

Entregables:

- cola canónica de eventos de dispositivo;
- worker mock separado;
- endpoints administrativos de simulación no productivos;
- interfaz para futuro adapter de molinete.

Gate:

- PIN no persiste en cola;
- biometría se representa solo con referencia opaca;
- eventos duplicados producen una sola decisión.

### Fase 7 — Absorción del backend heredado

Entregables:

- contrato canónico de importación;
- staging, dry-run, validación y reporte por registro;
- adapter mock y punto de extensión para adapter real;
- reconciliación idempotente.

Gate:

- ningún dato inválido entra a tablas canónicas;
- reimportar no duplica;
- el contrato real queda bloqueado hasta recibir muestra/export del sistema anterior.

### Fase 8 — Verificación de producción

Entregables:

- CI completo;
- smoke, e2e, carga y memoria;
- diagramas actualizados;
- runbooks, progreso y revisión final.

Gate:

- install, audit, format, lint, type-check, test, build, migración, restore y smoke verdes;
- PR permanece en borrador si cualquier gate falla.

## Desconocidos que no bloquean la base de software

- fabricante/modelo del molinete y lectores;
- protocolo de dispositivo y modo de autenticación del callback;
- semántica real de anti-passback;
- formato y calidad del backend heredado;
- proveedor final de SMS, WhatsApp o email;
- días de aviso aprobados por negocio;
- política legal final de retención y consentimiento biométrico.

Estos puntos se aíslan detrás de adapters y configuración. No se codifican supuestos de proveedor en el dominio.
