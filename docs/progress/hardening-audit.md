# GymSheet Backend — auditoría y plan de hardening

Fecha de corte: 2026-07-17  
Rama: `HARDENING`  
Base analizada: `main@44fcbdfd60a92cc7c486984a605e5a17ddadadc0`

## Dictamen ejecutivo

El código fue endurecido en una rama aislada y quedó preparado para revisión técnica mediante el PR borrador correspondiente. El estado correcto es:

> **Implementación de hardening completada para revisión; producción todavía bloqueada por tareas operativas y evidencia pendiente.**

No se debe fusionar ni desplegar hasta rotar los secretos históricamente expuestos, probar las migraciones con datos representativos, ensayar backup/restore y cerrar los controles pendientes de la checklist de producción.

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

## Hallazgos iniciales y tratamiento

### 1. Fugas de memoria y eficiencia de recursos

No se detectó una fuga clásica de listeners, intervalos o referencias globales crecientes. El riesgo real era **agotamiento progresivo de memoria y conexiones por operaciones sin límites**.

| Hallazgo | Riesgo | Tratamiento |
|---|---|---|
| listados con relaciones anidadas sin paginación | materialización ilimitada en RAM y consultas costosas | paginación y máximos explícitos |
| exportación completa en memoria | crecimiento proporcional al historial | exportación paginada y límite de registros |
| importación HTTP sin tamaño máximo | consumo de memoria y DoS | timeout, límite de bytes y procesamiento por lotes |
| pool PostgreSQL fijo y sin timeouts visibles | saturación y peticiones colgadas | pool, acquire, idle, connect y statement timeout configurables |
| bodies HTTP sin límite explícito | consumo de CPU/memoria | `REQUEST_BODY_LIMIT` validado |
| `dist/` versionado | drift, tamaño y revisión engañosa | eliminado del control de versiones |

### 2. Seguridad de la información

| Hallazgo | Severidad inicial | Tratamiento |
|---|---:|---|
| `.env` con credenciales y secretos JWT versionados | crítica | retirado del HEAD, ignorado y documentado el runbook; rotación e historia siguen siendo bloqueantes |
| TLS PostgreSQL sin verificación | alta | verificación activada por defecto y configurable explícitamente |
| JWT sin revalidar estado del usuario | alta | búsqueda del usuario activo en cada petición autenticada |
| issuer/audience/algoritmo no fijados | alta | claims y algoritmo HS256 explícitos |
| parámetros UUID sin validación | alta | pipe común de validación antes de PostgreSQL |
| errores técnicos inconsistentes | alta | respuesta tipo Problem Details, request ID y ocultación de stack en producción |
| conector externo susceptible a SSRF/agotamiento | alta | HTTPS, allowlist, redirecciones controladas, timeout y máximo de respuesta |
| CSV susceptible a fórmulas | alta | neutralización de celdas y escape correcto |
| relaciones media/ejercicio sin ownership uniforme | alta | autorización contextual por tipo y propietario |

### 3. Clean Code

- Se incorporaron mappers para no devolver modelos Sequelize directamente.
- Se separaron responsabilidades de transporte, negocio, persistencia e integración externa.
- Se eliminaron valores mágicos usados para distinguir ejercicios globales.
- Se centralizaron UUID, errores, request ID y configuración.
- Se mantuvo la regla de menos de 300 líneas; `ExercisesService` y `WorkoutsService` quedan cerca del umbral y requieren vigilancia si vuelven a crecer.
- Los comentarios explican invariantes, límites y decisiones no evidentes; no duplican cada línea obvia.

### 4. Nombres internos en inglés

La migración usa una estrategia compatible:

- propiedades, parámetros, funciones y enums internos en inglés;
- `field` conserva las columnas PostgreSQL existentes en español;
- la API v1 conserva campos externos existentes cuando cambiarlos rompería clientes;
- futuras versiones pueden adoptar DTOs externos completamente en inglés mediante versionado, no mediante ruptura silenciosa.

### 5. Estándares para reservas, noticias/blog y contabilidad

Esos módulos **no existen en el repositorio**. No se inventaron entidades, endpoints ni reglas críticas.

La aplicabilidad y requisitos futuros están documentados en:

`docs/standards/domain-standards-applicability.md`

Incluye RFC 5545 para calendarios, RFC 4287 y Schema.org para publicaciones, WCAG 2.2, NIIF/IFRS, ISO 4217 e ISO 20022 cuando corresponda, además de controles de concurrencia, idempotencia y auditoría.

### 6. Documentación inline y operativa

Se documentaron:

- configuración y límites de runtime;
- razones de validación JWT y autorización contextual;
- ciclo de importación y controles SSRF;
- modelo de multimedia, licencia, atribución, checksum y texto alternativo;
- migraciones y rollback;
- rotación/purga de secretos;
- gates de revisión de producción.

## Fases ejecutadas

| Fase | Estado | Resultado principal |
|---|---|---|
| 1. Contención y gobierno | completada | rama aislada, secretos retirados del HEAD, auditoría y runbook |
| 2. Runtime seguro y eficiente | completada | límites HTTP/DB, TLS, shutdown hooks, request ID y Helmet |
| 3. Auth, autorización y validación | completada | JWT endurecido, usuario activo, ownership y UUID |
| 4. Clean Code e inglés interno | completada | models, schemas, repositories, services y mappers refactorizados |
| 5. Ejercicios multimedia | completada | catálogo normalizado con licencia, atribución, alt text y checksum |
| 6. Conector de dataset | completada | importación idempotente, limitada y deshabilitada por defecto |
| 7. Migraciones, pruebas y CI | completada con cobertura inicial | migración reversible, unit tests y workflow locked/type-check/test/build |
| 8. Revisión final y PR | completada | PR borrador, checklist y gates explícitos |

## Evidencia automatizada

El workflow `Hardening CI` ejecuta:

1. `yarn install --frozen-lockfile`;
2. `yarn type-check`;
3. `yarn test`;
4. `yarn build`.

La ejecución del commit `81cd285fa2e61eba91c5dc5f45f8f9d91fcac600` finalizó correctamente. Los commits documentales y de limpieza posteriores deben conservar el mismo resultado antes de aprobación.

## Bloqueantes de producción

- Rotar las credenciales PostgreSQL y secretos JWT que estuvieron versionados.
- Purgar el historial de Git mediante una operación coordinada.
- Ejecutar `migration:up` y `migration:down` sobre una copia temporal representativa.
- Ampliar pruebas de autenticación, ownership, carreras e idempotencia del importador.
- Sincronizar OpenAPI y Postman con paginación, media, importación y errores.
- Ejecutar análisis de dependencias y resolver vulnerabilidades críticas/altas.
- Ensayar backup, restauración y rollback.
- Medir carga, memoria, p95/p99 y saturación del pool.
- Confirmar licencia antes de habilitar importación de archivos multimedia externos.

La checklist detallada está en `docs/reviews/production-readiness-review.md`.
