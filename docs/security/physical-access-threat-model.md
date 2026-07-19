# Threat model — membresías, biometría y control de acceso físico

## Activos críticos

- identidad del cliente y del trabajador;
- estado y vigencia de membresía;
- PIN hash y referencias biométricas opacas;
- decisiones de entrada/salida;
- configuración de sedes, salas, puntos y dispositivos;
- claves de firma de adapters y gateway de mensajería;
- historial de accesos y auditoría;
- jobs de recordatorio y entrega.

## Límites de confianza

```text
navegador ↔ API
API ↔ PostgreSQL
API ↔ cola/outbox
worker ↔ PostgreSQL
adapter de hardware ↔ hardware
adapter de hardware ↔ API/cola canónica
worker de notificación ↔ gateway externo
```

## Amenazas y controles

| Amenaza | Impacto | Control obligatorio |
|---|---|---|
| Replay de evento del molinete | acceso duplicado o auditoría falsa | `sourceEventId` único, timestamp, firma y ventana de tolerancia |
| Suplantación de dispositivo | apertura no autorizada | credencial por dispositivo, allowlist, rotación y canal TLS |
| Robo de plantilla biométrica | daño irreversible de privacidad | no almacenar muestra ni plantilla; referencia opaca solamente |
| PIN en logs o cola | compromiso de acceso | hash bcrypt; validación antes de encolar; redacción central |
| Credencial activa de exempleado | acceso indebido | perfil laboral con estado y revocación; decisión consulta estado actual |
| Membresía vencida todavía válida | pérdida comercial y seguridad | cálculo en fecha de negocio, constraints y pruebas de borde |
| Doble procesamiento | doble mensaje o doble decisión | claim atómico, deduplication key, consumidor idempotente |
| Saturación de eventos | denegación de servicio | batch, concurrencia, rate limit, backpressure y DLQ |
| Manipulación del reloj | días restantes incorrectos | reloj del servidor/DB; no confiar en timestamp del cliente |
| Mock habilitado en producción | bypass operacional | validación Zod que rechaza `MOCK` en producción |
| Adapter real defectuoso | aperturas/denegaciones incorrectas | homologación, contract tests, shadow mode y rollback |
| Importación heredada corrupta | contaminación de datos | staging, dry-run, Zod, reporte por registro y transacción |
| Mensaje repetido | molestia y costo | clave única por membresía, fecha, umbral y canal |
| Exposición de historial | riesgo de privacidad y seguridad física | RBAC, paginación, retención y auditoría de consulta crítica |

## Datos biométricos

El backend no debe recibir ni persistir:

- fotografía de enrolamiento;
- imagen facial capturada;
- imagen de huella;
- minucias;
- embeddings;
- template propietario;
- score biométrico detallado reutilizable.

Puede persistir:

- `externalCredentialReference` opaca;
- modalidad declarada;
- proveedor/dispositivo;
- estado;
- consentimiento y versión;
- fechas de enrolamiento, verificación y revocación;
- razón de revocación;
- metadata estrictamente no biométrica.

## Riesgos abiertos

- política jurídica definitiva de consentimiento y retención en Bolivia;
- capacidades PAD/FMR del hardware;
- soporte OSDP o protocolo alternativo;
- protección de claves del controlador;
- operación offline y reconciliación;
- procedimiento de emergencia y override manual;
- anti-passback y ocupación máxima.

Estos riesgos impiden aprobar el adapter real, pero no impiden construir el núcleo y el simulador.
