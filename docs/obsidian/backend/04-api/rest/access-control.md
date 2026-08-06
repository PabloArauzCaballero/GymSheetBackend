---
title: "REST · Access control"
type: api
status: verified
last_reviewed: "2026-08-06"
source_revision: "27f3fd2"
tags: [backend, api]
---

# REST · Access control

Control de acceso físico / biometría (adapter boundary, ADR-0002). **Ningún
endpoint de este grupo está en OpenAPI.** Tres controladores:

- `access-control.controller.ts` — historial y administración de dispositivos/eventos.
- `access-credential.controller.ts` — credenciales (PIN / referencia externa).
- `mock-access.controller.ts` — inyección de eventos simulados (solo no-producción).

Servicios: `access-control.service.ts`, `access-credential.service.ts`.

## Historial y dispositivos — `access-control.controller.ts`

| Método | Ruta | Rol/Owner | Body/query | Propósito |
|---|---|---|---|---|
| GET | `/access/me` | Owner | `accessHistoryFilterSchema` | Historial propio filtrable |
| GET | `/admin/access/devices` | ADMIN, FRONT_DESK | — | Lista dispositivos |
| POST | `/admin/access/devices` | ADMIN | `createDeviceSchema` | Crea dispositivo |
| PATCH | `/admin/access/devices/:id/status` | ADMIN | `updateDeviceStatusSchema` | Cambia estado |
| GET | `/admin/access/events/:id` | ADMIN, FRONT_DESK | — | Consulta evento |
| GET | `/admin/access/history` | ADMIN, FRONT_DESK | `accessHistoryFilterSchema` | Historial global |

## Credenciales — `access-credential.controller.ts`

| Método | Ruta | Rol/Owner | Body | Propósito |
|---|---|---|---|---|
| GET | `/access/credentials/me` | Owner | — | Credenciales propias |
| POST | `/admin/access/credentials/pin` | ADMIN, FRONT_DESK | `createPinCredentialSchema` | Crea PIN |
| POST | `/admin/access/credentials/external-reference` | ADMIN, FRONT_DESK | `createExternalCredentialSchema` | Referencia externa (biometría en adapter) |
| GET | `/admin/access/credentials/user/:userId` | ADMIN, FRONT_DESK | — | Credenciales de un usuario |
| PATCH | `/admin/access/credentials/:id/revoke` | ADMIN, FRONT_DESK | `revokeCredentialSchema` | Revoca |

## Mock — `mock-access.controller.ts` (endpoint MOCK)

| Método | Ruta | Rol | Body | Propósito |
|---|---|---|---|---|
| POST | `/admin/access/mock/events` | ADMIN | `mockAccessEventSchema` | Encola evento simulado |

> Gated por `ACCESS_MOCK_ENABLED` (def. false). `env.ts` **prohíbe**
> `ACCESS_MOCK_ENABLED=true` en `NODE_ENV=production` (falla el arranque). Solo para
> pruebas/desarrollo del pipeline de decisiones de acceso.

Los eventos alimentan el pipeline de decisiones (`AccessDecisionOutcome`,
`AccessDecisionReason`) vía outbox/worker `access-event`.

Relacionado: [[04-api/authorization]] · [[03-domains/access-control/index]]
