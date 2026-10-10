# ADR-0012 — Corrección de dependencias de producción vulnerables (C9)

Estado: aceptado · Fecha: 2026-10-10 · Rama: `fix/repp-deps-c9`

## Contexto

La auditoría de dependencias de producción de la rama `test`
(`yarn audit --groups dependencies`, el mismo cálculo que hace
`scripts/verify-yarn-audit.mjs` en CI) da **1 crítica, 8 altas, 17 moderadas y
1 baja** sobre 261 paquetes. El plan `PLAN_RUTINAS_REPP/10_CORRECCIONES_TESTFLIGHT_2026-10-10.md`
§C9 pide corregirlas con un ADR previo (regla `70-library-selection`).

| Sev. | Paquete | Versión bloqueada | Parche | Llega por | Aviso |
|---|---|---|---|---|---|
| crítica | `proxy-addr` | 2.0.7 | ≥ 2.0.8 | `@nestjs/platform-express > express` | GHSA-jqcg-44mw-7w3h (suplantación de IP con IPv6 mapeada a IPv4) |
| alta ×3 | `multer` | 2.2.0 | ≥ 2.3.0 (2.4.0 para la moderada) | `@nestjs/platform-express` | GHSA-wc9g-mqfw-jrwm, -qfvm-cv95-jqjf, -535w-7cp7-47q4 (DoS) |
| alta ×3 | `nodemailer` | 8.0.11 | ≥ 10.0.6 | directa | GHSA-p6gq-j5cr-w38f, -2x7j-588g-ccc2, -v53p-9fqp-m79j |
| alta ×2 | `brace-expansion` | 2.1.4 | ≥ 2.1.7 | `sequelize-typescript > glob > minimatch` | GHSA-qhr7-859c-m2p7, -6j4f-fj2g-mc7p |
| moderada | `qs` | 6.15.x | ≥ 6.16.0 | `express`, `body-parser` | GHSA-x5fp-wj9c-mxmx, -4mjr-xmp4-gh2g |
| moderada | `moment` | 2.30.x | ≥ 2.31.0 | `sequelize`, `moment-timezone` | GHSA-4p3w-j4w9-5jqw |
| moderada | `stream-json`, `decode-uri-component` | 1.x / 0.2.x | ≥ 3.6.0 / ≥ 0.5.0 | `minio@8.0.7` | varios |

Hechos que condicionan la decisión:

- **Nest fija `multer` exacto.** `@nestjs/platform-express` declara `multer` sin
  rango: `2.2.0` en todas las 11.1.x y en 11.2.0–11.2.6. La **11.2.7**
  (2026-09-30, misma mayor) es la primera de la 11 que trae `multer: "2.4.0"`;
  la 12.x también, pero es mayor de framework.
- **`proxy-addr`, `qs` y `moment` ya están dentro de rango.** `express@5.2.1` pide
  `proxy-addr ^2.0.7` y `qs ^6.14.0`; `sequelize` pide `moment ^2.29.4`. Basta con
  refrescar el lockfile.
- **`nodemailer` sólo tiene parche en la 10.x** (la 8.x y la 9.x quedan sin
  arreglo para GHSA-v53p). Es la única dependencia directa afectada.
- `minio@8.0.7` es la última publicada y pide `stream-json ^1.8.0` y
  `query-string ^7` (`decode-uri-component ^0.2`): no hay versión de minio que
  arregle esas moderadas.

## Opciones consideradas

| Opción | Arregla | Radio de impacto | Decisión |
|---|---|---|---|
| A. Nest 11 → 12 (todos los `@nestjs/*`) | multer | Mayor de framework: guards, pipes, adaptador, CLI, testing, throttler, sequelize, jwt, passport; 12.0.0 salió el 2026-08-27 | **Descartada** para esta corrección; se evalúa aparte |
| B. Nest 11.1.29 + `resolutions` `multer: 2.4.0` | multer | Fuerza una transitiva que Nest fija exacta | **Descartada**: existe C' sin resolución |
| C'. `@nestjs/*` alineados a `^11.2.7` | multer | Menor dentro de la 11 (websockets/socket.io ya estaban en 11.2.3); Nest es quien sube multer | **Elegida** |
| C. `resolutions` para `proxy-addr`/`qs`/`moment` | idem | Innecesario: ya están dentro de rango | **Descartada**: refresco de lockfile |
| D. nodemailer 8 → 9.x | parcial | No arregla GHSA-v53p (≤ 10.0.5) | **Descartada** |
| E. nodemailer 8 → `^10.0.16` | 8 avisos | Mayor; ver cambios abajo | **Elegida** |
| F. Forzar `stream-json@3` bajo minio | moderadas | Mayor de una dependencia interna de minio sin prueba de su autor | **Descartada**; residual moderado documentado |

### Cambios rompedores de nodemailer 9 y 10 frente al uso real

El único uso es `src/modules/notifications/delivery/smtp-mail.transport.ts`
(`createTransport({ host, port, secure, auth, *Timeout })` + `sendMail({ from,
to, subject, text, html, headers })`); `gmail-mail.transport.ts` no importa
nodemailer.

- 9.0.0: las descargas HTTPS de contenido remoto (adjuntos por URL, OAuth2,
  proxy CONNECT) validan el certificado por defecto. **No aplica**: no se usan
  adjuntos por URL, OAuth2 ni proxy; y validar TLS es lo deseable.
- 10.0.0: exige Node ≥ 20 (el proyecto declara `>=20 <24`; la imagen usa 22) y
  pasa a TypeScript con salidas ESM/CJS. Mantiene la forma de `@types/nodemailer`
  y la exportación CommonJS `require('nodemailer')` que usa el build de Nest.
- La API de `createTransport`/`sendMail` no cambia.

nodemailer 10 publica sus propias declaraciones (`dist/cjs/nodemailer.d.ts`) y
TypeScript las resuelve antes que `@types/nodemailer` (comprobado con
`tsc --traceResolution`). `@types/nodemailer` queda sin uso y se elimina
(regla 70: no conservar dependencias sin uso).

## Decisión

1. `@nestjs/{common,core,platform-express,platform-socket.io,websockets,testing}`
   de `^11.1.28` a `^11.2.7` (bloqueados en 11.2.7) — menor alineado, misma
   mayor. Trae `multer@2.4.0` sin `resolutions`. `@nestjs/jwt`, `passport`,
   `sequelize`, `throttler`, `cli` y `schematics` no se tocan (no tienen avisos).
2. `nodemailer` de `^8` a `^10.0.16`, bloqueado en **10.0.16** en `yarn.lock`
   (no en la 10.1.0, publicada el mismo día de este cambio: se prefiere una
   versión con días de uso). Se retira `@types/nodemailer`.
3. `resolutions`: `brace-expansion` de `^2.1.4` a `^2.1.7` (ver ADR-0004). No se
   añade ninguna resolución nueva.
4. `proxy-addr`, `qs`, `moment`: refresco de sus entradas en `yarn.lock` dentro
   del rango que ya piden sus padres.
5. Residual aceptado: las 2 moderadas de `minio` (`stream-json`,
   `decode-uri-component`), sin parche publicado compatible. El gate de CI es
   alto+crítico, así que no lo bloquean; se revisa al salir minio 9.
6. `yarn.lock` es el lockfile de verdad (Dockerfile y CI usan
   `yarn install --frozen-lockfile`). `package-lock.json` no se toca aquí: la
   regla 70 prohíbe mezclar gestores y regenerarlo con npm sería precisamente
   eso. Su retirada se decide aparte.
7. El aviso de auditoría de `test-ci.yml` pasa de informativo a bloqueante para
   alta y crítica en cuanto este cambio llegue a `test`. Ese workflow vive hoy
   sólo en la rama `fix/test-ci-reintento` (no está en `test`, `dev` ni en esta
   rama), así que el cambio se aplica allí o al fusionar ambas; el «Hardening CI»
   de `main` ya bloquea con el mismo `scripts/verify-yarn-audit.mjs`.

## Consecuencias

- Producción sin vulnerabilidades altas ni críticas conocidas a 2026-10-10.
- Ninguna resolución transitiva nueva; la de `brace-expansion` sólo sube de
  suelo.
- La migración a Nest 12 queda como trabajo separado con su propio ADR.

## Verificación

Ver `PLAN_RUTINAS_REPP/evidencia/C9_dependencias.md`: auditoría antes/después,
lint, type-check, build, unitarias, e2e de rutinas/programas/entrenos/auth/subidas
y arranque real de `dist/main.js` contra `/health/ready`.
