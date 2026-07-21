---
name: security-audit
description: Revisión de seguridad basada en riesgos reales del código NestJS/Sequelize/JWT. Cubre autenticación, autorización horizontal y de función (BOLA/BFLA), validación, inyección, secretos, JWT/sesiones, SSRF, CORS, rate limiting, logs sensibles y dependencias. Úsala antes de exponer endpoints o al auditar seguridad. Documenta de forma defensiva, sin instrucciones de explotación.
---

# security-audit

## Propósito
Encontrar y corregir riesgos de seguridad reales, con prueba negativa que lo demuestre.

## Cuándo usarla
Nuevos endpoints, cambios de auth/permisos, manejo de archivos o URLs, auditoría de seguridad.

## Cuándo NO usarla
No sustituye un SAST ni una auditoría externa; complementa.

## Fuentes obligatorias
`src/modules/auth`, `src/common/guards`, `*.schemas.ts`, `src/config/env.ts`, `.claude/rules/30-security.md`.

## Entradas requeridas
Diff o módulo a revisar; para prueba negativa, PostgreSQL de prueba.

## Condiciones para detenerse
Necesidad de secretos reales, producción o explotación activa contra sistemas externos.

## Flujo por fases
1. **AuthN**: hashing bcrypt, expiración JWT HS256, revalidación del principal, anti-enumeración
   (login gasta `compare` sin cuenta).
2. **AuthZ / BOLA-BFLA**: guards en backend; propiedad por recurso; acceso ajeno → **404**; endpoints
   admin protegidos; sin confianza en IDs manipulados.
3. **Entrada**: validación Zod estricta; mass assignment bloqueado (campos no declarados descartados);
   `UuidParamPipe`.
4. **Inyección/SSRF**: consultas parametrizadas; URLs salientes contra allowlist; límites de payload.
5. **Secretos/errores/logs**: sin secretos en repo/logs; errores sin stack/SQL; correlation ID saneado.
6. **Transporte**: helmet, CORS por allowlist, rate limiting (compartido en multi-instancia).
7. **Dependencias**: `yarn audit:prod`.

## Comandos permitidos
`yarn audit:prod`, `yarn test`, pruebas e2e negativas.

## Comandos prohibidos
Explotación contra sistemas reales; exponer o registrar secretos; instrucciones ofensivas operativas.

## Evidencia requerida
Por hallazgo: ruta, severidad, impacto, escenario (defensivo), corrección y **prueba negativa** que
falla sin el fix.

## Entregables
Matriz de riesgos + correcciones + pruebas.

## Formato de respuesta
Tabla de hallazgos (ID, severidad, prioridad, estado) ordenada por severidad.

## Lista de verificación final
Permisos en backend; acceso ajeno 404; entradas validadas; sin secretos; errores sin fuga; rate
limiting efectivo; dependencias sin vulnerabilidades altas.

## Limitaciones
Sin CLI `claude` no se instala 42crunch/Semgrep/Aikido; se documentan como pendientes de operador.

## Trazabilidad
`programacionBackend.md` §3 (aportado) y hallazgos F-003/F-007/F-011/F-013/F-014 de la auditoría.
