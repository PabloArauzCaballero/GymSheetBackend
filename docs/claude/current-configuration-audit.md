# Auditoría de la configuración de Claude Code existente

**Fecha:** 2026-07-21 · **Rama:** `HARDENING`

## Inventario previo (antes de esta organización)

| Ruta | Estado | Acción |
|---|---|---|
| `.claude/settings.json` | Existe — hooks de graphify (PostToolUse, Stop) | **Conservar sin modificar** |
| `.claude/hooks/graphify-mark-dirty.ps1` | Existe | Conservar |
| `.claude/hooks/graphify-rebuild.ps1` | Existe | Conservar |
| `CLAUDE.md` (proyecto) | **No existe** | Crear (Fase 5) |
| `.claude/rules/` | No existe | Crear (Fase 6) |
| `.claude/skills/` | No existe | Crear (Fase 7) |
| `.claude/agents/` | No existe | No crear — ninguna responsabilidad justifica hoy un subagente |
| `.claude/settings.local.json` | No existe | No se crea; se añade a `.gitignore` preventivamente |
| `.mcp.json` | No existe | No se crea — sin MCP aprobado y sin CLI para instalarlos |

## Conflictos y duplicaciones

Ninguno. No había `CLAUDE.md` de proyecto, reglas ni skills previas, por lo que **no hay
instrucciones duplicadas ni contradictorias** que reconciliar. El único contenido preexistente son
los hooks de graphify, que son ortogonales a esta organización.

## Riesgos detectados en la configuración

| Riesgo | Severidad | Corrección |
|---|---|---|
| `.claude/settings.local.json` no está en `.gitignore` | Media | Añadido a `.gitignore` — si alguien crea el archivo con overrides personales, no debe versionarse (§3.3, §13) |
| Hooks ejecutan PowerShell con `-ExecutionPolicy Bypass` | Informativa | Preexistente y propiedad del usuario (graphify); no se modifica |

## Elementos que deben conservarse

- Todo el bloque `hooks` de `.claude/settings.json` (fusión, nunca reemplazo).
- Los dos scripts de graphify.
- `BACKEND_AUDIT_HARDENING_AND_ACTION_PLAN.md` y `docs/` existentes.

## Contenido obsoleto

Ninguno identificado.
