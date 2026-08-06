---
title: "Stack tecnológico"
type: overview
status: verified
criticality: medium
last_reviewed: "2026-08-06"
source_files: ["package.json", "CLAUDE.md"]
tags: [backend, overview, stack]
---

# Stack tecnológico

> No sustituir sin ADR (`docs/decisions/`).

| Capa | Tecnología | Versión | Evidencia |
|---|---|---|---|
| Runtime | Node.js | — | `package.json` |
| Framework | NestJS | 11 | `@nestjs/*` |
| Lenguaje | TypeScript (strict) | 5.7 | `tsconfig.json` |
| ORM | Sequelize | 6 | `sequelize` |
| Base de datos | PostgreSQL | 16 | `docs/db/schema.sql`, compose |
| Validación | Zod | 3 | `*.schemas.ts` |
| Auth | JWT HS256 (access+refresh) + bcrypt | — | `auth` module |
| Cache/rate limit | Redis (opcional) | — | `REDIS_URL` |
| Contenedores | Docker + Docker Compose | — | `Dockerfile`, `docker-compose.yml` |
| CI | GitHub Actions | — | `.github/` |
| Gestor de paquetes | **yarn** | — | `yarn.lock` |

## Notas

- Mensajería propia basada en **transactional outbox** (ADR-0005), sin broker externo.
- Rate limiting compartido vía Redis en multi-instancia; sondas de health nunca dependen de él.

Ver [[01-overview/repository-map]] y [[02-architecture/architecture-overview]].
