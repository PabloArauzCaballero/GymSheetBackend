# Trazabilidad de skills y reglas

**Fecha:** 2026-07-21

| Skill / Regla | Capacidad | Fuente | Implementación | Evidencia |
|---|---|---|---|---|
| `backend-hardening` | Auditoría por fases con evidencia | `programacionBackend.md` (aportado) + auditoría ejecutada | `.claude/skills/backend-hardening/SKILL.md` | `BACKEND_AUDIT_HARDENING_AND_ACTION_PLAN.md` (F-001…F-016) |
| `production-verification` | Gates + arranque real + fallo de dependencias | Criterios de aceptación §15 (aportado) | `.claude/skills/production-verification/SKILL.md` | §9 de la auditoría |
| `security-audit` | BOLA/BFLA, JWT, inyección, secretos | `programacionBackend.md` §3 (aportado) | `.claude/skills/security-audit/SKILL.md` | F-003, F-007/F-011, F-013, F-014 |
| `clean-code-review` | Nombres, cohesión, duplicación, errores | Clean Code (R.C. Martin) + `programacionGeneral.md` (aportado) | `.claude/skills/clean-code-review/SKILL.md` | 24 errores de lint corregidos (F-001) |
| `library-selection` | Matriz + no duplicar + no usadas | `programacionBackend.md` (aportado) | `.claude/skills/library-selection/SKILL.md` | ADR-0003 (deps eliminadas) |
| Regla `10-backend-architecture` | Capas, mappers, 404, outbox | Código real | `.claude/rules/10-backend-architecture.md` | `src/modules/**`, `integration/` |
| Regla `30-security` | AuthN/Z, secretos, SSRF, rate limiting | Código real | `.claude/rules/30-security.md` | `src/modules/auth`, `src/common/guards` |
| Regla `40-observability` | Health/readiness, logs de worker | Código real | `.claude/rules/40-observability.md` | F-010, F-015 |
| Regla `80-database` | Sin sync destructivo, migraciones | Código real | `.claude/rules/80-database.md` | `src/database/migrations/` |

**Nota de derechos:** no se copiaron fragmentos extensos de libros ni documentos protegidos; se
resumen principios con atribución. Los ficheros `index.md`, `programacionGeneral.md` y
`programacionBackend.md` no están versionados en el repo (aportados en la conversación); su contenido
se refleja de forma resumida.
