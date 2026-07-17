# Revisión de preparación para producción

Fecha de corte: 2026-07-17  
Rama evaluada: `HARDENING`  
Base: `main@44fcbdfd60a92cc7c486984a605e5a17ddadadc0`

## Dictamen

**Estado: LISTO PARA REVISIÓN TÉCNICA, NO AUTORIZADO TODAVÍA PARA PRODUCCIÓN.**

El hardening reduce riesgos críticos del código y agrega controles verificables, pero existen actividades operativas que no pueden completarse únicamente con un cambio de repositorio: rotación de secretos, limpieza coordinada del historial, prueba real de migraciones, restauración de backup y validación del entorno de despliegue.

## Evidencia automatizada

GitHub Actions `Hardening CI` ejecuta en Node.js 22:

1. instalación con `yarn install --frozen-lockfile`;
2. verificación de tipos con `yarn type-check`;
3. pruebas unitarias con `yarn test`;
4. build de producción con `yarn build`.

La ejecución asociada al commit `81cd285fa2e61eba91c5dc5f45f8f9d91fcac600` terminó correctamente. Cada commit posterior debe volver a obtener una ejecución verde antes de aprobar el PR.

## Gate 1 — Secretos y configuración

- [x] `.env` retirado del HEAD.
- [x] `.env`, variantes locales, artefactos y logs ignorados.
- [x] validación temprana de variables mediante Zod.
- [x] secretos JWT diferentes y con longitud mínima.
- [x] issuer, audience y algoritmo JWT explícitos.
- [ ] **rotar credenciales PostgreSQL y secretos JWT expuestos históricamente.**
- [ ] purgar el historial con procedimiento coordinado y comunicar el cambio a todos los clones.
- [ ] verificar secretos en el gestor del entorno de despliegue.

**Bloqueante:** cualquier secreto histórico aún válido.

## Gate 2 — Base de datos e integridad

- [x] `synchronize` deshabilitado.
- [x] pool, tiempo de conexión y `statement_timeout` configurables.
- [x] TLS con validación de certificado por defecto.
- [x] migración versionada y reversible para hardening de ejercicios y media.
- [x] restricciones e índices para identidades externas e integridad principal.
- [ ] ejecutar `migration:up` sobre una copia temporal representativa.
- [ ] verificar conteos, constraints e índices posteriores.
- [ ] ejecutar `migration:down` en entorno desechable.
- [ ] ensayar backup y restauración con tiempos registrados.

**Bloqueante:** migración no ensayada con datos representativos.

## Gate 3 — Seguridad de API

- [x] límite de body HTTP.
- [x] Helmet y `x-powered-by` deshabilitado.
- [x] CORS por allowlist.
- [x] rate limiting global y específico de autenticación.
- [x] UUID de ruta validado antes de acceder a PostgreSQL.
- [x] JWT revalida usuario activo y rol en cada petición.
- [x] errores normalizados sin stack trace en producción.
- [x] request ID en respuesta y logs.
- [x] conector externo con allowlist de host, HTTPS, timeout y límite de bytes.
- [x] DTO mappers evitan exponer modelos ORM directamente.
- [ ] prueba de abuso para ownership de ejercicios, sesiones, series y media.
- [ ] prueba de rate limit y payload sobredimensionado en un entorno HTTP real.
- [ ] análisis SAST/dependencias sin vulnerabilidades críticas o altas pendientes.

## Gate 4 — Recursos y rendimiento

- [x] listados de ejercicios y entrenamientos paginados.
- [x] exportación acotada por páginas y CSV protegido contra fórmulas.
- [x] importación externa por lotes y tamaño máximo.
- [x] conexiones y statements con timeout.
- [x] `dist/` eliminado del control de versiones.
- [ ] prueba de carga representativa para lectura de ejercicios, creación de series y exportación.
- [ ] medir memoria RSS, p95/p99, errores y saturación del pool.
- [ ] definir presupuesto de rendimiento y capacidad esperada.

No se detectó una fuga clásica de listeners o timers en el código revisado. El riesgo principal original era el crecimiento no acotado de resultados y exportaciones en memoria.

## Gate 5 — Clean Code y mantenibilidad

- [x] nombres internos principales en inglés.
- [x] compatibilidad preservada mediante `field` para columnas existentes y respuestas v1.
- [x] separación controller/service/repository/mapper.
- [x] funciones y decisiones no evidentes documentadas.
- [x] archivos manuales por debajo de 300 líneas.
- [ ] dividir `ExercisesService` y `WorkoutsService` si continúan creciendo; ambos están cerca del umbral de revisión de diseño.
- [ ] ampliar pruebas de reglas de negocio, no únicamente helpers y schemas.

Los comentarios deben explicar invariantes, riesgos o razones. No se debe comentar cada línea obvia, porque eso duplica el código y se desactualiza.

## Gate 6 — Contratos y documentación

- [x] auditoría y plan por fases.
- [x] runbook de rotación de secretos.
- [x] matriz de estándares para reservas, noticias/blog y contabilidad.
- [x] documentación de migraciones y conector de dataset.
- [ ] sincronizar OpenAPI con todos los endpoints, paginación, media, importación y formato de errores.
- [ ] sincronizar colección Postman con OpenAPI.
- [ ] añadir ejemplos de errores RFC 9457 y límites de paginación.

## Gate 7 — Operación

- [x] shutdown hooks activados.
- [x] CI con permisos mínimos de lectura.
- [x] concurrencia de CI para cancelar ejecuciones obsoletas.
- [ ] readiness que compruebe dependencia de PostgreSQL sin convertir liveness en una consulta pesada.
- [ ] métricas y alertas para tasa de errores, latencia, pool y fallos del conector.
- [ ] política de retención de logs y redacción validada.
- [ ] rollback de aplicación y migración ensayado.

## Revisión obligatoria antes de fusionar

1. Seguridad: revisar secretos, JWT, autorización contextual, SSRF y errores.
2. Datos: revisar migración, constraints, transacciones e idempotencia.
3. API: validar compatibilidad v1 y OpenAPI.
4. Operación: revisar variables, proxy, TLS, logs, backup y rollback.
5. Negocio: validar que el catálogo externo y su licencia pueden usarse.

## Decisión de despliegue

La aprobación final requiere evidencia firmada o registrada de todos los puntos bloqueantes. Un CI verde demuestra que el código compila y supera las pruebas configuradas; **no demuestra por sí solo que el sistema sea seguro, escalable ni recuperable en el entorno real.**
