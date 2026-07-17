# Matriz de aplicabilidad de estándares

Fecha de revisión: 2026-07-17

## Propósito

Este documento evita dos errores opuestos:

1. declarar cumplimiento de normas que el sistema todavía no implementa;
2. diseñar futuros módulos sin contratos interoperables, controles de seguridad o criterios contables claros.

GymSheetBackend actualmente administra identidad, perfiles antropométricos, catálogos de ejercicios y equipos, sesiones de entrenamiento, archivos multimedia y exportaciones. **No contiene módulos de reservas, noticias, blog, pagos ni contabilidad.** Por tanto, los estándares de esos dominios se registran como requisitos de diseño futuro y no como cumplimiento actual.

## Convenciones

- **Aplicable:** existe una capacidad del sistema que debe cumplir el control.
- **Condicional:** será obligatorio únicamente si se incorpora el módulo indicado.
- **No aplicable hoy:** no existe código ni regla de negocio de ese dominio.
- **Evidencia requerida:** artefacto que debe existir antes de declarar cumplimiento.

## Controles transversales actuales

| Referencia | Estado | Aplicación en GymSheetBackend | Evidencia esperada |
|---|---|---|---|
| OWASP ASVS 5.0 | Aplicable | autenticación, autorización, validación, errores, secretos, configuración y protección de datos | pruebas, revisión de configuración y checklist por control |
| OWASP API Security Top 10 2023 | Aplicable | ownership, límites de consumo, inventario de endpoints, SSRF del conector externo y autorización administrativa | tests de abuso, límites configurados y revisión de rutas |
| NIST SP 800-218 SSDF | Aplicable | gobierno del cambio, dependencias, CI, revisión de vulnerabilidades y respuesta a secretos expuestos | workflow, lockfile, reporte de auditoría y runbooks |
| RFC 9457 Problem Details | Aplicable | representación consistente de errores HTTP sin stack traces ni datos sensibles | pruebas de error y contrato OpenAPI |
| WCAG 2.2 | Condicional al frontend | el backend debe proporcionar textos alternativos, errores comprensibles y datos suficientes para una interfaz accesible | contratos de media y validación e2e con el frontend |
| ISO 8601 / RFC 3339 | Aplicable | timestamps de API en UTC, offsets explícitos y ausencia de fechas ambiguas | ejemplos OpenAPI y pruebas de serialización |

## Reservas y agenda

**Estado actual: no aplicable.** No se encontraron entidades, endpoints, estados ni transiciones de reserva.

Si se incorpora este dominio, el diseño debe aprobar antes de implementar:

| Referencia o práctica | Uso requerido |
|---|---|
| RFC 5545 iCalendar | importación/exportación de eventos y compatibilidad con calendarios externos |
| IANA Time Zone Database | persistir el identificador de zona, no solo un offset temporal |
| ISO 8601 / RFC 3339 | contratos de fechas y horas con offset explícito |
| Idempotency-Key para comandos | evitar reservas duplicadas ante reintentos de red |
| Control de concurrencia en PostgreSQL | constraint, lock o exclusión para impedir sobre-reserva |
| Auditoría de transiciones | registrar creación, confirmación, cancelación, reprogramación y actor |
| PCI DSS | solo si el sistema almacena, procesa o transmite datos de tarjeta; preferir proveedor externo tokenizado |

No debe existir una implementación basada únicamente en `SELECT` seguido de `INSERT`: esa secuencia permite carreras concurrentes. La regla de no solapamiento debe quedar protegida en la base de datos y probada bajo concurrencia.

## Noticias y blog

**Estado actual: no aplicable.** No existen publicaciones, autores editoriales, taxonomías, moderación ni feeds.

Si se incorpora este dominio:

| Referencia o práctica | Uso requerido |
|---|---|
| Schema.org `Article`, `NewsArticle` y `BlogPosting` | metadatos estructurados generados por el frontend o capa de presentación |
| RFC 4287 Atom | feed interoperable cuando se ofrezca sindicación |
| WCAG 2.2 | jerarquía semántica, alternativas textuales, navegación y formularios accesibles |
| Sanitización con allowlist | contenido enriquecido; prohibido confiar en HTML del cliente |
| Política editorial y moderación | estados borrador, revisión, publicado, retirado y trazabilidad de cambios |
| Canonical URL y metadatos de procedencia | evitar duplicados y conservar fuente, autor y fecha de actualización |

Las entradas deben separar contenido fuente, contenido renderizado y metadatos. El backend no debe aceptar scripts, manejadores de eventos HTML ni URLs no validadas.

## Contabilidad y finanzas

**Estado actual: no aplicable.** No existe plan de cuentas, comprobantes, asientos, periodos, impuestos, conciliaciones ni estados financieros.

Si se incorpora contabilidad:

| Referencia o práctica | Uso requerido |
|---|---|
| NIIF/IFRS aplicables y normativa boliviana vigente | definición contable validada por profesional competente; no se deduce solo desde software |
| Partida doble | cada comprobante cuadrado; débitos y créditos con moneda y periodo definidos |
| ISO 4217 | códigos de moneda y precisión monetaria por moneda |
| ISO 20022 | solo para intercambio de mensajes financieros con instituciones que lo requieran |
| Periodos cerrados e inmutabilidad | prohibir edición destructiva; corregir mediante reversión o asiento compensatorio |
| Auditoría | actor, origen, aprobación, fecha efectiva, fecha de registro y correlación |
| Idempotencia y transacciones | evitar asientos duplicados y garantizar atomicidad |

Los importes monetarios deben usar tipos decimales; nunca `float` de JavaScript para cálculos contables. La adopción de NIIF, impuestos o reportes regulatorios exige requisitos aprobados por contabilidad y asesoría legal local.

## Decisión de alcance

No se agregaron entidades, endpoints ni migraciones de reservas, noticias, blog o contabilidad porque faltan reglas de negocio críticas. Inventarlas violaría el principio de cero adivinanzas definido en los prompts del proyecto.

Antes de comenzar cualquiera de esos módulos se requiere, como mínimo:

1. actores, permisos y segregación de funciones;
2. estados y transiciones válidas;
3. reglas de concurrencia e idempotencia;
4. retención, privacidad y auditoría;
5. contratos de entrada/salida;
6. requisitos legales y regulatorios aplicables;
7. criterios de aceptación y pruebas de abuso.

## Fuentes oficiales consultadas

- OWASP ASVS: https://owasp.org/www-project-application-security-verification-standard/
- OWASP API Security: https://owasp.org/API-Security/
- NIST SSDF: https://csrc.nist.gov/pubs/sp/800/218/final
- RFC 9457: https://www.rfc-editor.org/rfc/rfc9457
- RFC 5545: https://www.rfc-editor.org/rfc/rfc5545
- RFC 4287: https://www.rfc-editor.org/rfc/rfc4287
- WCAG 2.2: https://www.w3.org/TR/WCAG22/
- Schema.org: https://schema.org/Article
- ISO 20022: https://www.iso20022.org/
- IFRS issued standards: https://www.ifrs.org/issued-standards/list-of-standards/
