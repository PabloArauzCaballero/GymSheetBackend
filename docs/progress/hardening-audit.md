# GymSheet Backend — auditoría y cierre de hardening

Fecha de corte: 2026-07-17  
Rama: `HARDENING`  
Base analizada: `main@44fcbdfd60a92cc7c486984a605e5a17ddadadc0`

## Dictamen ejecutivo

> **El hardening del repositorio está implementado y verificado para revisión técnica. El despliegue a producción continúa bloqueado únicamente por acciones externas y operativas que requieren credenciales, infraestructura o aprobación legal.**

No se debe fusionar ni desplegar mientras permanezca válido un secreto históricamente expuesto, el historial no haya sido saneado de forma coordinada o no exista autorización para reutilizar multimedia externa.

## Fuentes y reglas aplicadas

La revisión aplica:

- `prompt/index.md`;
- `prompt/programacionGeneral.md`;
- `prompt/programacionBackend.md`;
- diagramas de `docs/systemInfo`;
- OWASP ASVS 5.0;
- OWASP API Security Top 10 2023;
- NIST SP 800-218 SSDF;
- RFC 9457 para errores HTTP;
- principios de Clean Code.

Reglas de implementación:

- TypeScript estricto y entradas externas validadas con Zod.
- Archivos manuales menores a 300 líneas.
- Controllers limitados al transporte; reglas en services; persistencia en repositories.
- Secretos fuera del repositorio y de los logs.
- Consultas paginadas y límites explícitos de recursos.
- Integraciones HTTP con HTTPS, allowlist, timeout, límite de bytes, validación e idempotencia.
- Cambios de esquema mediante migraciones versionadas y reversibles.
- No declarar producción lista sin evidencia operativa.

## Hallazgos y tratamiento

### 1. Memoria y eficiencia de recursos

No se detectó una fuga clásica de listeners, intervalos o referencias globales crecientes. El riesgo real era **agotamiento progresivo de memoria y conexiones por operaciones sin límites**.

| Hallazgo | Tratamiento verificado |
|---|---|
| listados con relaciones anidadas sin paginación | paginación y máximos explícitos |
| exportación completa en memoria | lectura paginada, límite de registros y neutralización CSV |
| importación HTTP sin tamaño máximo | timeout, límite de bytes, validación integral y lotes |
| pool PostgreSQL sin límites operativos claros | pool, acquire, idle, connect y statement timeout configurables |
| bodies HTTP sin límite explícito | `REQUEST_BODY_LIMIT` y respuesta real `413` |
| observabilidad capaz de crecer sin límite | registro de métricas limitado a 250 series |
| `dist/` versionado | eliminado del control de versiones |

### 2. Seguridad de la información

| Hallazgo | Severidad inicial | Tratamiento |
|---|---:|---|
| `.env` con credenciales y secretos JWT versionados | crítica | retirado del HEAD, ignorado y documentado; rotación e historia siguen siendo bloqueantes externos |
| TLS PostgreSQL sin verificación | alta | verificación activada por defecto y configurable explícitamente |
| JWT sin revalidar estado del usuario | alta | búsqueda del usuario activo y rol actual en cada petición |
| issuer/audience/algoritmo no fijados | alta | claims y algoritmo explícitos |
| parámetros UUID sin validación | alta | pipe común antes de PostgreSQL |
| errores técnicos inconsistentes | alta | `application/problem+json`, request ID y redacción de 5xx |
| body sobredimensionado convertido en 500 | alta | conservación segura del `413` de Express sin filtrar detalles internos |
| conector susceptible a SSRF/agotamiento | alta | HTTPS, allowlist, rechazo de redirects, timeout y máximo de respuesta |
| upsert externo con carrera check-then-insert | alta | `findOrCreate`, constraints únicas y transacciones |
| CSV susceptible a fórmulas | alta | neutralización de celdas y escape correcto |
| relaciones sin ownership uniforme | alta | autorización contextual por tipo y propietario |
| dependencias con avisos críticos/altos | alta | actualización coordinada a NestJS 11 y lockfile auditado sin vulnerabilidades conocidas |

### 3. Clean Code y nombres

- Mappers evitan devolver modelos Sequelize.
- Controller, service, repository, mapper, schema e integración externa tienen responsabilidades separadas.
- Los nombres internos principales están en inglés.
- `field` conserva columnas PostgreSQL existentes y la API v1 mantiene compatibilidad externa.
- Las asociaciones Sequelize usan aliases explícitos para evitar consultas dependientes de inferencia.
- Comentarios y documentación explican invariantes, límites y decisiones no evidentes.
- `ExercisesService` y `WorkoutsService` permanecen por debajo de 300 líneas, pero deben dividirse antes de agregar nuevas responsabilidades.

### 4. Estándares de dominio solicitados

Los módulos de reservas, noticias/blog y contabilidad no existen en este repositorio. No se inventaron entidades o reglas críticas. La aplicabilidad futura está documentada en:

```txt
docs/standards/domain-standards-applicability.md
```

Incluye RFC 5545, RFC 4287, Schema.org, WCAG 2.2, NIIF/IFRS, ISO 4217 e ISO 20022 cuando corresponda, además de controles de concurrencia, idempotencia y auditoría.

## Fases ejecutadas

| Fase | Estado | Resultado principal |
|---|---|---|
| 1. Contención y gobierno | completada | rama aislada, secretos retirados del HEAD, auditoría y runbook |
| 2. Runtime seguro y eficiente | completada | límites HTTP/DB, TLS, shutdown hooks, request ID y Helmet |
| 3. Auth, autorización y validación | completada | JWT endurecido, usuario activo, ownership y UUID |
| 4. Clean Code e inglés interno | completada | models, schemas, repositories, services y mappers refactorizados |
| 5. Ejercicios multimedia | completada | catálogo normalizado con licencia, atribución, alt text y checksum |
| 6. Conector de dataset | completada | importación idempotente, limitada y deshabilitada por defecto |
| 7. Migraciones, pruebas y CI | completada | migración reversible, pruebas, restore y gates automatizados |
| 8. Observabilidad y rendimiento | completada | métricas, presupuestos y smoke HTTP con evidencia |
| 9. Contratos y operación | completada | OpenAPI, Postman, errores RFC 9457 y runbooks |
| 10. Revisión final | completada para código | PR borrador y bloqueantes externos explícitos |

## Evidencia automatizada

La ejecución `Hardening CI` **29617887569** sobre el commit de implementación `1cb6b2e3278cd96dbaaa484989e5cbc5c8ee0049` terminó correctamente en todos sus pasos:

1. instalación congelada con Yarn;
2. auditoría de dependencias de producción;
3. type-check estricto;
4. pruebas unitarias;
5. build de producción;
6. creación de esquema y datos representativos;
7. migración `up`, `down` y reaplicación;
8. verificación de metadatos e integridad;
9. `pg_dump` y `pg_restore` en una base desechable;
10. rollback y reaplicación sobre la restauración;
11. prueba HTTP de carga, memoria y controles de abuso.

### Resultado de dependencias

```json
{
  "info": 0,
  "low": 0,
  "moderate": 0,
  "high": 0,
  "critical": 0
}
```

El CI falla automáticamente si reaparece una vulnerabilidad crítica o alta en dependencias de producción.

### Resultado del smoke HTTP

| Operación | Solicitudes | Errores | p95 | p99 |
|---|---:|---:|---:|---:|
| lectura paginada de ejercicios | 60 | 0 | 87.80 ms | 96.34 ms |
| creación concurrente de series | 20 | 0 | 62.46 ms | 63.71 ms |
| exportación JSON acotada | 15 | 0 | 79.27 ms | 79.27 ms |

Memoria RSS:

```txt
antes:      126,541,824 bytes
después:    142,721,024 bytes
crecimiento: 16,179,200 bytes
presupuesto: 67,108,864 bytes
```

Controles funcionales observados:

- payload mayor al límite: HTTP `413`;
- rate limit de autenticación: HTTP `429` observado;
- cero errores en lecturas, escrituras y exportaciones medidas.

Estas cifras corresponden al runner de CI y son una protección contra regresiones; no constituyen una certificación de capacidad del entorno productivo.

## Bloqueantes externos de producción

- Rotar las credenciales PostgreSQL y secretos JWT que estuvieron versionados.
- Purgar el historial Git mediante una operación coordinada y renovar clones/cachés.
- Verificar los nuevos secretos en el gestor del entorno de despliegue.
- Confirmar legalmente la licencia antes de habilitar importación de multimedia externa.
- Repetir migración, restore y carga en staging con volumen, red, proxy y límites equivalentes a producción.
- Registrar aprobación de seguridad, datos, operación y negocio antes de fusionar.

La checklist detallada está en `docs/reviews/production-readiness-review.md`.
