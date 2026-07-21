# Inventario de entorno — Claude Code

**Fecha:** 2026-07-21 · **Repositorio:** GymSheetBackend · **Rama:** `HARDENING`

## Versiones verificadas

| Herramienta | Versión | Cómo se obtuvo |
|---|---|---|
| Node.js | v22.23.1 | `node --version` |
| Git | 2.52.0.windows.1 | `git --version` |
| Claude Code CLI | **no disponible en PATH** | `claude --version` → `command not found` |

## Stack detectado (evidencia real)

| Elemento | Valor | Evidencia |
|---|---|---|
| Sistema operativo | Windows 11 | entorno de la sesión |
| Shell | PowerShell (primario) + Bash | entorno de la sesión |
| Gestor de paquetes | **yarn** | `yarn.lock` presente |
| Node requerido | `>=20 <24` | `package.json` engines |
| Framework | NestJS 11 | `package.json` |
| Lenguaje | TypeScript 5.7 (strict) | `tsconfig.json` |
| ORM | Sequelize 6 + sequelize-typescript | `package.json` |
| Base de datos | PostgreSQL 16 | `docs/db/schema.sql`, migraciones |
| Validación | Zod 3 | `src/**/*.schemas.ts` |
| Auth | JWT HS256 (passport-jwt) | `src/modules/auth` |
| Rate limiting | @nestjs/throttler + Redis opcional | `src/app.module.ts` |
| Caché / colas | Redis (opcional) + outbox transaccional | `src/common/redis`, `integration.outbox_jobs` |
| Contenedores | Docker + docker-compose | `Dockerfile`, `docker-compose.yml` |
| CI/CD | GitHub Actions | `.github/workflows/hardening-ci.yml` |
| Observabilidad | Prometheus (endpoint propio) | `/health/metrics` — sin plataforma externa (Sentry/Datadog/Grafana no presentes) |
| OpenAPI | **no existe** | sin `openapi.yaml`/`json` |
| IaC | **no existe** | sin Terraform ni AWS |

## Limitaciones del entorno para este encargo

1. **La CLI `claude` no está en el PATH.** No es posible ejecutar `claude plugin install`,
   `claude plugin list`, `claude plugin details` ni verificar el marketplace. En consecuencia, la
   **instalación de plugins queda fuera de lo ejecutable** en esta sesión (§7 y §3.1 del documento de
   orquestación exigen no declarar disponible lo que no se puede verificar). Se entrega en su lugar
   la matriz de selección y un script de instalación listo para que el operador lo ejecute.
2. **Windows no entrega SIGTERM con semántica POSIX**, por lo que las pruebas de apagado ordenado se
   ejercitan en contenedores Linux / CI (ya verificado, ver `BACKEND_AUDIT_HARDENING_AND_ACTION_PLAN.md`).

## Archivos fuente del framework que NO existen en el repositorio

Referenciados como obligatorios por `CLAUDE_ORGANIZAR_SKILLS_BACKEND.md` §2, ausentes como ficheros:

- `index.md`
- `programacionGeneral.md`
- `programacionBackend.md`
- `claude_backend_skills_recomendadas.json` (aportado como documento de chat, no versionado)

Las skills y reglas se derivan por tanto de las fuentes **realmente disponibles**: el contenido
aportado en la conversación, el código y la configuración reales, y
`BACKEND_AUDIT_HARDENING_AND_ACTION_PLAN.md` (auditoría ya ejecutada sobre este repositorio).

## Datos no verificables

- Disponibilidad y versión de cada plugin del catálogo (CLI ausente).
- Estado del marketplace oficial.
- Compatibilidad de escáneres SAST (Semgrep/Aikido) con este Windows.

No se copiaron variables de entorno sensibles en este documento.
