# Configuración de Claude Code

Organización para desarrollo backend profesional de este repositorio.

- `settings.json` — configuración compartida (hooks de graphify). Fusionar, nunca reemplazar.
- `settings.local.json` — configuración personal/temporal. **Ignorado por Git.**
- `rules/` — reglas modulares por tema; las que llevan `paths` solo aplican en sus rutas.
- `skills/` — procedimientos especializados, invocables por nombre.
- `hooks/` — scripts de graphify (preexistentes).
- `backups/` — respaldos de configuración. Ignorado por Git.

Reglas breves y estables: `../CLAUDE.md`. Reportes de organización: `../docs/claude/`.
Estado de producción y auditoría: `../BACKEND_AUDIT_HARDENING_AND_ACTION_PLAN.md`.
