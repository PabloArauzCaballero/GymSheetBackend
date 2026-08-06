---
title: "Versionado"
type: api
status: verified
last_reviewed: "2026-08-06"
source_revision: "27f3fd2"
tags: [backend, api]
---

# Versionado

Evidencia: `src/main.ts` (`setGlobalPrefix`), `src/config/env.ts` (`API_PREFIX`),
`docs/endpoints/openapi.yaml` (`info.version`, `servers`),
`docs/endpoints/endpoints.md`.

## Estrategia actual: versión en el prefijo de ruta

- El versionado es **por URL**, embebido en `API_PREFIX` (def. `api/v1`). Todas las
  rutas cuelgan de `/api/v1/...`.
- No se usa el `VersioningType` nativo de NestJS (`enableVersioning`) ni cabecera
  `Accept-Version`. El nivel de versión es el segmento `v1` del prefijo global.
- OpenAPI declara `info.version: 1.1.0-hardening` y `server` `http://localhost:3001/api/v1`.
  `GET /gateway/routes` reporta `version: 'v1'`.

## Compatibilidad v1 en el borde

Se conservan **nombres de campo en español** en la frontera HTTP por
compatibilidad con clientes v1 (`nombreCompleto`, `pesoKg`, `estaturaCm`,
`grupoMuscular`, `rol`, `observacion`…), mapeados internamente a identificadores en
inglés. El modelo de error mantiene además campos de compatibilidad
(`ok`, `statusCode`, `path`, `error`) junto a los de RFC 9457 — ver
[[error-model]] y [[conventions]].

## No hay v2 — INFERIDO

> No existe un `v2` ni un mecanismo de negociación de versión en la revisión
> `27f3fd2`. Cambiar de versión mayor implicaría, según reglas del proyecto, un ADR
> en `docs/decisions/`. Un cambio de `API_PREFIX` reubica **toda** la superficie;
> no hay convivencia de versiones simultáneas configurada.

Relacionado: [[conventions]] · [[index]]
