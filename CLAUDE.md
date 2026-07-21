# GymSheet Backend — instrucciones del proyecto

Backend NestJS de gestión de gimnasio: entrenamientos, ejercicios, membresías, control de acceso
físico/biometría, notificaciones. **No** es una plataforma de inteligencia económica ni tiene ingesta
por agentes de IA (ver nota de alcance en `BACKEND_AUDIT_HARDENING_AND_ACTION_PLAN.md` §0).

## Precedencia

1. Requisitos aprobados y reglas de negocio.
2. Reglas en `.claude/rules/` (gobernanza, arquitectura, seguridad, etc.).
3. Contratos y diagramas vigentes (`docs/`).
4. Código y pruebas existentes.
5. Supuestos documentados.

## Stack (no sustituir sin ADR)

NestJS 11 · TypeScript 5.7 strict · Sequelize 6 · PostgreSQL 16 · Zod 3 · JWT HS256 · Redis (rate
limiting compartido, opcional) · Docker · GitHub Actions. Gestor de paquetes: **yarn**.

## Comandos reales (verificados en package.json)

```bash
yarn install --frozen-lockfile   # instalar
yarn lint                        # ESLint 9 (flat config, type-aware)
yarn type-check                  # tsc --noEmit
yarn test                        # unitarias (jest --runInBand)
yarn test:e2e                    # e2e — requiere PostgreSQL en :5433
yarn build                       # nest build → dist/main.js
yarn migration:up | :down        # migraciones (ts-node)
yarn audit:prod                  # auditoría de dependencias de producción
docker compose up -d --build     # pila completa (postgres, redis, migrate, api, workers)
```

## Reglas críticas

- Trabaja con precisión; no inventes requisitos, comandos, librerías ni plugins.
- Detente ante contradicciones críticas y ante acciones irreversibles (migraciones destructivas,
  `git push`, OAuth, secretos, producción, recursos cloud).
- No expongas secretos ni los escribas en archivos versionados. `.env` está ignorado; solo se
  versiona `.env.example`.
- Conserva el stack y el gestor de paquetes existentes.
- Valida toda entrada externa con Zod; nunca devuelvas modelos ORM directamente (usa los mappers).
- La autorización se aplica en el backend; el acceso horizontal responde 404, no 403.
- **No declares éxito sin ejecutar evidencia** (lint, type-check, test, y ejecución real cuando aplique).
  Cuatro defectos graves de este repo (F-012, F-014, F-015, F-016) fueron invisibles a los gates y
  solo aparecieron al ejecutar y romper el sistema a propósito.

## Skills del proyecto (`.claude/skills/`)

Invócalas por nombre para procedimientos especializados:

| Necesidad | Skill |
|---|---|
| Auditoría/endurecimiento por fases | `backend-hardening` |
| Verificar que un cambio funciona de verdad | `production-verification` |
| Revisión de seguridad (BOLA/BFLA, JWT, inyección…) | `security-audit` |
| Revisión de Clean Code | `clean-code-review` |
| Elegir/añadir una librería | `library-selection` |

## Documentación

- Auditoría y estado de producción: `BACKEND_AUDIT_HARDENING_AND_ACTION_PLAN.md`.
- Organización de Claude Code y reportes: `docs/claude/`.
- Reglas modulares: `.claude/rules/`.

## Evidencia

Registra las verificaciones ejecutadas, sus resultados y las limitaciones. No afirmes que una
integración funciona si no fue autenticada y probada.
