# Informe de instalación

**Fecha:** 2026-07-21

## Plugins instalados

**Ninguno.** La CLI `claude` no está en el PATH de este entorno, por lo que no fue posible instalar ni
verificar plugins. Ver `plugin-selection-matrix.md` y `install-recommended-plugins.ps1`.

## Plugins recomendados (pendientes de ejecución por el operador)

Perfil mínimo: `typescript-lsp`, `code-simplifier`, `security-guidance`, `context7`, `github`,
`skill-creator`, `session-report`, `redis-development`. Scope sugerido: `user`.

## Descartados / diferidos

- Descartados por stack: `neon`, `terraform`, `aws-dev-toolkit`, `sentry`/`datadog`/`grafana*`,
  `mcp-server-dev`, `plugin-dev`, `playwright`.
- Diferidos: `42crunch-api-security-testing` y `postman` (sin OpenAPI), `semgrep`/`aikido` (elegir uno;
  compatibilidad Windows por verificar).

## Prerrequisitos

- `typescript-lsp`: `npm install -g typescript-language-server typescript`.
- Integraciones (`github`, etc.): autenticación con permisos mínimos, en el momento de instalar.

## Cambios de archivos (esta organización)

- **Creados:** `CLAUDE.md`, `.claude/rules/*` (10), `.claude/skills/*` (5), `docs/claude/*` (7),
  `docs/decisions/ADR-0003-*.md`.
- **Modificados:** `.gitignore` (ignora `.claude/settings.local.json`), `package.json` + `yarn.lock`
  (eliminadas `class-transformer` y `@nestjs/config`; añadida `resolution` de `brace-expansion` para
  CVE-2025-5889, ADR-0004), `.github/workflows/hardening-ci.yml` (e2e con `AUTH_RATE_LIMIT_MAX=100`).
- **ADRs creados:** ADR-0003 (deps no usadas), ADR-0004 (brace-expansion).
- **Conservados sin cambios:** `.claude/settings.json` (hooks de graphify), scripts de graphify.

## Autenticación pendiente

Toda integración externa (GitHub MCP, etc.) queda pendiente de autenticación por el operador.

## Riesgos

- No compartir por `--scope project` plugins con MCP/hooks sin aprobación del equipo.
- Revisar la fuente de plugins comunitarios (`serena`, `context7`) antes de habilitarlos.
