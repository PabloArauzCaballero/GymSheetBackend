# ADR-0003 — Eliminación de dependencias de producción no utilizadas

**Fecha:** 2026-07-21 · **Estado:** Aceptado · **Rama:** `HARDENING`

## Contexto

Al organizar Claude Code para desarrollo backend (regla `70-library-selection`, skill
`library-selection`), la revisión de `package.json` detectó dos dependencias de **producción** sin
ninguna referencia en `src/`:

| Dependencia | Usos en `src/` | Motivo de su ausencia de uso |
|---|---|---|
| `class-transformer` | 0 (`grep -rl` → sin coincidencias) | El proyecto valida y transforma con **Zod** (`ZodValidationPipe`), no con `class-validator`/`class-transformer`. No se usa `ValidationPipe` de Nest. |
| `@nestjs/config` | 0 | La configuración se carga con un módulo propio `src/config/env.ts` (dotenv + Zod), no con `ConfigModule`/`ConfigService`. |

## Decisión

Eliminar ambas dependencias:

```bash
yarn remove class-transformer @nestjs/config
```

## Verificación (evidencia ejecutada)

| Comprobación | Resultado |
|---|---|
| `yarn type-check` | ✅ sin errores |
| `yarn lint` | ✅ 0 errores |
| `yarn test` (unitarias) | ✅ 107/107 |
| `yarn build` + artefacto | ✅ `dist/main.js` presente |
| `yarn test:e2e` (bootstrap completo de `AppModule`) | ✅ 26/26 |

El arranque completo vía e2e demuestra que ningún proveedor de Nest requería estas librerías en
tiempo de bootstrap.

## Consecuencias

- `package.json` refleja fielmente las dependencias realmente usadas (regla de no dependencias
  injustificadas).
- Superficie de suministro y de vulnerabilidades ligeramente menor.
- Si en el futuro se adopta `ValidationPipe` con DTOs de `class-validator` o `ConfigModule`, deberán
  reinstalarse de forma explícita y justificada.

## Nota de flakiness observada (no relacionada)

La suite e2e puede fallar de forma intermitente cuando las dos suites registran varias cuentas
seguidas y agotan el límite de autenticación (`AUTH_RATE_LIMIT_MAX`) compartido en el proceso. No es
un defecto de código ni consecuencia de esta eliminación; se mitiga ejecutando el e2e con un límite de
autenticación holgado. Documentado como riesgo de aislamiento de pruebas.
