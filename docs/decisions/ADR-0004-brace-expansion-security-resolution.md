# ADR-0004 — Resolución de seguridad para `brace-expansion` (CVE-2025-5889)

**Fecha:** 2026-07-21 · **Estado:** Aceptado · **Rama:** `HARDENING`

## Contexto

Durante la verificación de la organización de Claude Code, `yarn audit --groups dependencies --level
high` (script `audit:prod`, sobre el que **falla el CI** vía `scripts/verify-yarn-audit.mjs`) reportó
**1 vulnerabilidad alta**:

```
high · brace-expansion: DoS via exponential-time expansion (CVE-2025-5889)
Path: sequelize-typescript > glob > minimatch > brace-expansion   (resuelto a 1.1.15)
```

### Verificación de origen

El lockfile **ya versionado en `HEAD`** resolvía `brace-expansion@^1.1.7` a la misma `1.1.15`. Por
tanto:

- La exposición es **preexistente**, no introducida por los cambios de esta sesión (eliminación de
  `class-transformer`/`@nestjs/config`, ADR-0003).
- Las ejecuciones anteriores de `yarn audit` que devolvían "0 vulnerabilidades" **preceden** a la
  publicación del aviso en la base de datos de avisos de npm; el aviso ahora lo marca.
- El CI habría empezado a fallar en su próxima ejecución con independencia de esta sesión.

`sequelize-typescript` es dependencia de **producción**, por lo que la exposición cuenta como riesgo
real de producción. La línea 5.x de `brace-expansion` (`5.0.7`) no está marcada por el aviso.

## Decisión

Forzar `brace-expansion` a la línea parcheada 2.x mediante `resolutions` en `package.json`:

```json
"resolutions": {
  "uuid": "11.1.1",
  "brace-expansion": "^2.0.2"
}
```

Tras `yarn install`, todo el árbol colapsa a `brace-expansion@2.1.2` (versión única). La API pública
`expand()` es estable entre las líneas 1.x/2.x, por lo que los consumidores (`minimatch`/`glob`) no se
ven afectados funcionalmente.

## Verificación (evidencia ejecutada)

| Comprobación | Antes | Después |
|---|---|---|
| `yarn audit:prod` (high) | ❌ 1 high (brace-expansion) | ✅ 0 vulnerabilidades / 178 paquetes |
| `yarn type-check` | ✅ | ✅ |
| `yarn lint` | ✅ | ✅ |
| `yarn test` | ✅ 107/107 | ✅ 107/107 |
| `yarn build` + artefacto | ✅ | ✅ `dist/main.js` |
| `yarn test:e2e` (bootstrap real) | ✅ 26/26 | ✅ 26/26 |

El e2e ejercita el arranque completo y peticiones reales, confirmando que forzar `brace-expansion` a
2.x no rompe el runtime.

## Consecuencias

- CI vuelve a pasar el gate de auditoría de producción.
- Si un consumidor futuro requiriese específicamente la API de una línea mayor distinta de 2.x, habría
  que revisar esta resolución.

## Nota operativa relacionada (flakiness de e2e)

Se observó que las dos suites e2e pueden agotar `AUTH_RATE_LIMIT_MAX` al registrar varias cuentas en
un mismo proceso `--runInBand`. Mitigación aplicada: el paso e2e de CI ejecuta con
`AUTH_RATE_LIMIT_MAX=100`. Localmente: `AUTH_RATE_LIMIT_MAX=100 yarn test:e2e`. No es un defecto de
código.
