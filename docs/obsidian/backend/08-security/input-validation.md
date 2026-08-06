---
title: "Validación de entrada"
type: security
status: verified
criticality: high
last_reviewed: "2026-08-06"
source_revision: "27f3fd2"
source_files:
  - "src/common/pipes/zod-validation.pipe.ts"
  - "src/common/pipes/uuid-param.pipe.ts"
  - "src/modules/auth/auth.schemas.ts"
  - "src/main.ts"
tags: [backend, security, validation, zod, mass-assignment]
---

# Validación de entrada

> Defensivo. Toda entrada externa se trata como **no confiable**.

## Mecanismo (VERIFICADO)

- **Zod por esquema** en archivos `*.schemas.ts`, aplicado con `ZodValidationPipe`
  (`auth.controller.ts:25,32`). Cada endpoint valida su cuerpo con un schema explícito.
- **Anti mass-assignment**: los objetos Zod **descartan campos no declarados**. Un cliente no puede
  inyectar atributos no previstos (p. ej. `role`, `id`) porque no forman parte del schema y se
  eliminan antes de llegar al servicio.
- **Normalización defensiva**: emails con `trim`, `toLowerCase`, `max(180)`; contraseñas
  `min(8).max(128)`; nombres acotados (`auth.schemas.ts`). Esto también acota tamaño y formato.
- **Validación de parámetros de ruta**: `UuidParamPipe` garantiza que los identificadores de ruta
  sean UUID válidos antes de tocar la base de datos, reduciendo superficie de inyección/errores.
- **Límite de cuerpo**: `json({ limit: REQUEST_BODY_LIMIT, strict: true })` y `urlencoded` acotado
  (`main.ts:31-33`) — rechaza payloads grandes y JSON no estricto.
- **Validación de configuración**: el propio entorno se valida con Zod al arranque (ver
  [[08-security/secrets-management]]).

## Manejo de errores de validación

Los fallos de Zod se traducen a un error HTTP con `issues` estructurados que el
`HttpExceptionFilter` expone de forma controlada (`http-exception.filter.ts:102-105`), sin filtrar
detalles internos. Ver [[08-security/data-protection]].

## Cobertura y brechas

- La protección anti mass-assignment es efectiva **solo donde el endpoint usa su schema**. Endpoints
  que omitan `ZodValidationPipe` no gozan del descarte de campos → auditar consistencia (INFERIDO).
- Validar que **todo** parámetro de ruta identificador use `UuidParamPipe`.

Relacionado: [[04-api/authentication]] · [[08-security/threat-model]] · [[08-security/authorization]].
