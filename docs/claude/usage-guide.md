# Guía de uso — Claude Code en este proyecto

**Fecha:** 2026-07-21

## Skills del proyecto

| Necesidad | Skill | Cómo invocarla | Evidencia esperada |
|---|---|---|---|
| Auditar / endurecer / "revisa y corrige el proyecto" | `backend-hardening` | Por nombre | Hallazgos, correcciones y pruebas de regresión |
| Verificar que un cambio funciona | `production-verification` | Por nombre | Tabla de gates + arranque real |
| Revisión de seguridad | `security-audit` | Por nombre | Matriz de riesgos + prueba negativa |
| Revisión de Clean Code | `clean-code-review` | Por nombre | Diff simplificado + justificación |
| Elegir / añadir librería | `library-selection` | Por nombre | Matriz + ADR si aplica |

Las skills se cargan bajo demanda; el `CLAUDE.md` y las reglas de `.claude/rules/` se aplican de forma
persistente (las reglas con `paths` solo en sus rutas).

## Reglas modulares

`.claude/rules/`: `00-governance`, `10-backend-architecture`, `20-clean-code`, `30-security`,
`40-observability`, `50-performance`, `60-testing`, `70-library-selection`, `80-database`,
`90-documentation`.

## Comandos internos de Claude Code

`/doctor`, `/plugin`, `/reload-plugins`, `/code-review`, `/run`, `/verify` — disponibles cuando la CLI
`claude` esté en el PATH. No se inventan slash commands: verificar con `claude plugin details` los que
aporte cada plugin instalado.

## Plugins

Perfil recomendado y script en `plugin-selection-matrix.md` e `install-recommended-plugins.ps1`. No se
instaló ninguno en esta sesión (CLI ausente).

## Regla de oro del proyecto

No declares algo terminado sin ejecutar evidencia. Los gates (lint/type-check/test) no bastan para
código desplegable: verifica arranque real y comportamiento ante fallo de dependencias (lección de
F-012/F-014/F-015/F-016 en la auditoría).
