# Matriz de selección de plugins

**Fecha:** 2026-07-21 · **Marketplace:** `claude-plugins-official`

> **Estado de ejecución:** la CLI `claude` no está en el PATH de este entorno, por lo que **no se pudo
> verificar la disponibilidad real ni instalar ningún plugin**. Las decisiones siguientes son
> recomendaciones sobre el catálogo aportado (`claude_backend_skills_recomendadas.json`), no
> instalaciones ejecutadas. El operador debe verificar cada nombre con
> `claude plugin details <plugin>@claude-plugins-official` antes de instalar (§6.2 del documento).

## Decisiones para este stack (NestJS · TS · PostgreSQL · Sequelize · Zod · Redis · Docker · GitHub)

| Plugin | Categoría | Decisión | Scope | Justificación (evidencia real) |
|---|---|---|---|---|
| `typescript-lsp` | Code intelligence | **Instalar** | user | Todo el código es TS strict. Requiere `npm i -g typescript-language-server typescript`. |
| `code-simplifier` | Clean code | **Instalar** | user | Complementa `clean-code-review` sobre el diff. |
| `security-guidance` | Seguridad | **Instalar** | user | Revisión de seguridad del diff/commit. Base recomendada. |
| `context7` | Librerías | **Instalar** | user | Documentación por versión fijada en lockfile; apoya `library-selection`. |
| `github` | Delivery | **Instalar** | user | El repo usa GitHub Actions y PRs. Token de permisos mínimos, sin escritura a `main`. |
| `postman` | API testing | **Evaluar** | user | Útil, pero **no hay OpenAPI** en el repo; valor menor hasta que exista. |
| `playwright` | Testing E2E | **Descartar (por ahora)** | — | Backend sin frontend en este repo; los e2e reales ya usan supertest. |
| `42crunch-api-security-testing` | Seguridad API | **Diferir** | user | Requiere `openapi.yaml/json`, inexistente. Reevaluar si se publica OpenAPI. |
| `redis-development` | Eficiencia | **Instalar (condicional)** | user | El proyecto ya usa Redis (rate limiting). Útil para TTL/invalidación/memoria. |
| `codspeed` | Rendimiento | **Evaluar** | user | Solo si se adoptan benchmarks reproducibles más allá del smoke actual. |
| `pr-review-toolkit` | Clean code | **Evaluar** | user | Solaparía con `security-guidance`/`code-review`; elegir uno para revisión profunda. |
| `serena` | Clean code | **Evaluar** | user | Comunidad; revisar fuente antes de habilitar. |
| `session-report` | AI observability | **Instalar** | user | Controla costo de contexto y skills demasiado grandes. |
| `claude-code-setup` | Workflow IA | **Evaluar** | user | Ya se hizo la organización manual; útil para revisiones futuras. |
| `claude-md-management` | Workflow IA | **Evaluar** | user | Mantener `CLAUDE.md` estable; el actual ya es breve. |
| `skill-creator` | Workflow IA | **Instalar** | user | Para evolucionar las skills de `.claude/skills/`. |
| `sentry` / `datadog` / `grafana-mcp` / `grafana-cloud-mcp` | Observabilidad | **Descartar** | — | No hay plataforma externa de observabilidad en el proyecto. Elegir **una sola** si se adopta. |
| `semgrep` / `aikido` | SAST | **Diferir — elegir uno** | user | Compatibilidad de Semgrep con este Windows sin verificar (posible WSL). Un solo SAST principal. |
| `neon` | Base de datos | **Descartar** | — | PostgreSQL es autoalojado/Docker, no Neon. |
| `terraform` / `aws-dev-toolkit` | Infraestructura | **Descartar** | — | Sin IaC ni AWS en el repo. |
| `mcp-server-dev` / `plugin-dev` | Workflow IA | **Descartar** | — | No se construyen MCP ni plugins distribuibles hoy. |

## Perfil mínimo recomendado para instalar (tras verificar con `claude plugin details`)

`typescript-lsp`, `code-simplifier`, `security-guidance`, `context7`, `github`, `skill-creator`,
`session-report`, y `redis-development` (por usar Redis).

## Reglas aplicadas

- **Una sola** plataforma de observabilidad y **un solo** SAST si se adoptan (no varios "por prevención").
- **Un solo** LSP por conjunto de extensiones (`typescript-lsp`).
- Plugins con MCP/hooks: revisar la fuente y usar credenciales de mínimo privilegio antes de compartir
  por `--scope project`.

## Riesgo de contexto

Instalar todo el catálogo cargaría skills/MCP innecesarios cada sesión. El perfil mínimo mantiene el
contexto acotado (§3.4). Revisar periódicamente con `session-report`.
