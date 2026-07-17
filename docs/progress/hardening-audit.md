# GymSheet Backend — auditoría y plan de hardening

Fecha de corte: 2026-07-17  
Rama: `HARDENING`  
Base analizada: `main@44fcbdfd60a92cc7c486984a605e5a17ddadadc0`

## Reglas aplicadas

La revisión aplica `prompt/index.md`, `prompt/programacionGeneral.md`, `prompt/programacionBackend.md`, los diagramas de `docs/systemInfo`, OWASP API Security Top 10 2023, NIST SSDF y principios de Clean Code.

- TypeScript estricto y entradas externas validadas con Zod.
- Archivos manuales menores a 300 líneas.
- Controllers limitados al transporte; reglas en servicios; persistencia en repositories.
- Secretos fuera del repositorio y de los logs.
- Consultas paginadas y límites explícitos de recursos.
- Integraciones HTTP con allowlist, timeout, límite de bytes, validación e idempotencia.
- Cambios de esquema mediante migraciones.
- No afirmar que compila o está listo para producción sin evidencia.

## Hallazgos iniciales

### Críticos

1. El repositorio contenía un `.env` con credenciales de PostgreSQL y claves JWT. El archivo fue retirado del HEAD de `HARDENING`; los valores deben rotarse y el historial debe purgarse mediante un procedimiento separado.
2. No existe un sistema ejecutable de migraciones ni seeds; las carpetas solo contienen README.
3. Los scripts Jest permiten `--passWithNoTests`, por lo que una ejecución verde no demuestra comportamiento.

### Altos

1. `z.coerce.boolean()` interpreta la cadena `false` como verdadera.
2. El JWT se acepta sin confirmar que el usuario exista y siga activo.
3. Los UUID de parámetros de ruta no se validan antes de consultar PostgreSQL.
4. Los listados de ejercicios no tienen paginación ni límite máximo.
5. Varias respuestas exponen modelos Sequelize.
6. TLS de PostgreSQL desactiva la verificación del certificado.
7. No hay logs estructurados con redacción ni request ID.
8. No hay límites configurables para bodies ni importaciones externas.

### Medios

1. Identificadores internos mezclan español e inglés.
2. Se usa un UUID cero como valor mágico para consultar ejercicios globales.
3. Las relaciones ejercicio-equipo se reemplazan sin validar previamente todos los equipos.
4. No existe un catálogo normalizado para imágenes, GIF, atribución, licencia, checksum y texto alternativo.
5. OpenAPI y Postman no cubren conectores, media, errores ni paginación.
6. `dist/` está versionado y puede divergir de `src/`.

## Fases

1. Contención y gobierno.
2. Runtime seguro y eficiente.
3. Autenticación, autorización y validación de identificadores.
4. Clean Code y nombres internos en inglés, preservando compatibilidad de API y base de datos.
5. Modelo de ejercicios multimedia.
6. Conector idempotente con `hasaneyldrm/exercises-dataset`.
7. Migraciones, pruebas, documentación y CI.
8. Verificación final y pull request.

## Gates de producción

No aprobar producción mientras exista cualquiera de estas condiciones:

- credenciales expuestas sin rotar;
- migraciones no probadas en una base temporal;
- ausencia de pruebas de autenticación, ownership e importación idempotente;
- importación de media externa sin licencia confirmada;
- build o type-check fallido;
- vulnerabilidad crítica o alta sin excepción documentada;
- restauración de backup no ensayada.
