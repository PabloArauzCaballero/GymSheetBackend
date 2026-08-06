---
title: "Access-control"
type: domain
status: verified
criticality: high
last_reviewed: "2026-08-06"
source_revision: "27f3fd2"
domain: "access-control"
source_files: [
  "src/modules/access-control/access-control.controller.ts",
  "src/modules/access-control/access-control.service.ts",
  "src/modules/access-control/access-control.repository.ts",
  "src/modules/access-control/access-policy.evaluator.ts",
  "src/modules/access-control/access-credential.service.ts",
  "src/modules/access-control/mock-access.controller.ts"
]
tags: [backend, domain]
related: ["[[03-domains/membership/index]]", "[[03-domains/facilities/index]]", "[[03-domains/integration/index]]"]
---

# Access-control

## Resumen

Dominio núcleo del control de acceso físico/biometría. Dos submódulos Nest:
`AccessCredentialModule` (credenciales) y `AccessControlModule` (dispositivos, cola de eventos,
decisiones e historial). Implementa el boundary PACS de ADR-0002: separa autenticación (hardware/
adaptador) de autorización (evaluador de política).

## Responsabilidad

- Gestionar credenciales de acceso (PIN con hash bcrypt; referencias externas opacas FACE/FINGERPRINT).
- Recibir eventos canónicos de dispositivos en una cola durable y decidir GRANTED/DENIED.
- Persistir decisiones auditables y exponer historial (propio y admin).

## Límites

- No almacena plantillas/imágenes biométricas: solo `externalReference` opaca + consentimiento.
- No integra SDK de proveedor; el adaptador real se conecta por `adapterKey`/`externalDeviceId`.
- No calcula la membresía; la consume de `membership`.

## Entradas

- HTTP autenticado (admin y `/access/me`, `/access/credentials/me`), Zod `.strict()`.
- Eventos canónicos: `MockAccessController` (gated `ACCESS_MOCK_ENABLED`) o el futuro adaptador.
- Worker `access-event.runner` que reclama y procesa eventos de la cola.

## Salidas

- `AccessDecisionModel` (una decisión por evento, FK único).
- Domain event `ACCESS_DECISION_RECORDED` **encolado al outbox** dentro de la transacción.
- Mappers exponen `referenciaExternaRegistrada: boolean`, nunca el hash ni la referencia.

## Casos de uso

- Usuario: consultar su historial de accesos y sus credenciales.
- ADMIN/FRONT_DESK: administrar dispositivos, credenciales, consultar eventos e historial global.
- Worker: procesar eventos de la cola → decisión.

## Reglas de negocio (evaluador `access-policy.evaluator.ts`)

Función pura `evaluateAccessPolicy(context)` con reglas ordenadas de corto-circuito:
1. Usuario no ACTIVE → `USER_INACTIVE`.
2. Credencial no ACTIVE → `CREDENTIAL_INACTIVE`.
3. Dispositivo no ACTIVE → `DEVICE_INACTIVE`.
4. Dirección no permitida → `DIRECTION_NOT_ALLOWED`.
5. Staff ACTIVO + `unlimitedAccess` + sucursal en scope → GRANTED `STAFF_ACCESS`.
6. Membresía: ausente/`SUSPENDED`/`NOT_STARTED`/`EXPIRED`/no ACTIVE → DENIED.
7. Scope: alguna con `branchId` coincidente y (`roomId` null wildcard o coincide) → si no,
   `ACCESS_SCOPE_DENIED`.
8. Caso feliz → GRANTED `ACTIVE_MEMBERSHIP` con `daysRemaining`.

## Componentes principales

| Componente | Tipo | Responsabilidad | Evidencia |
|---|---|---|---|
| `evaluateAccessPolicy` | Función pura | Decisión de autorización | `access-policy.evaluator.ts` |
| `AccessControlService` | Service | Dispositivos, `enqueueAuthenticatedEvent`, `processEvent`, historial | `access-control.service.ts` |
| `AccessCredentialService` | Service | PIN/externa, revoke, `verifyPin`, `resolveExternalReference` | `access-credential.service.ts` |
| `AccessControlRepository` | Repository | Cola con `FOR UPDATE SKIP LOCKED`, backoff, dead-letter | `access-control.repository.ts` |
| `MockAccessController` | Controller | Simula el adaptador (gated env) | `mock-access.controller.ts` |

## Entidades y datos

Esquema `access_control`: `AccessCredentialModel` (credentials; `pinHash`, `externalReference`,
consentimiento), `AccessDeviceModel` (devices; ligado a access point), `AccessDecisionModel`
(decisions; `deviceEventId` único), `AccessDeviceEventModel` (device_events; evento canónico + cola:
`queueStatus`, `attemptCount`, `availableAt`, `lockedBy`...). Detalle: [[05-data/index]].

## Endpoints o contratos

- `GET /access/me`; `GET /access/credentials/me`.
- Admin: `/admin/access/devices` (list/create/status), `/admin/access/events/:id`,
  `/admin/access/history`; credenciales `/admin/access/credentials/{pin,external-reference,
  user/:userId, :id/revoke}`; `POST /admin/access/mock/events` (gated).
- [[04-api/index]].

## Eventos

`ACCESS_DECISION_RECORDED` (aggregate `access_decision`, dedup `access.decision-recorded:${id}`,
`correlationId = sourceEventId`) vía `DomainEventPublisher.record` dentro de la transacción de
decisión. La propia tabla `device_events` es la cola procesada por el worker.

## Dependencias

`MembershipModule` (`findStaffByUserId`, `findCurrentMembership`), `facilities/access-point.model`
(dirección/sucursal/sala del dispositivo), `UsersModule`, `IntegrationModule` (publisher/catalog).
Consumido por `src/workers/access-event.runner.ts`.

## Autenticación y permisos

Guards globales; controladores admin `@Roles(ADMIN, FRONT_DESK)`, escrituras de dispositivos y mock
a `@Roles(ADMIN)`. `/access/me` y `/credentials/me` fuerzan `user.id` del token (sin id del cliente).
Recurso ausente/ajeno → 404.

## Manejo de errores

`NotFoundException` (dispositivo/evento/credencial), `UnprocessableEntityException` (usuario/credencial
inexistente o inactivo), `ConflictException` (lease de worker inválido, referencia externa duplicada).
`UniqueConstraintError` se traduce a registro existente o 409, nunca 500 (idempotencia).

## Transacciones y consistencia

`enqueueAuthenticatedEvent` y `processEvent` corren en transacción con locks. La cola usa raw SQL
`FOR UPDATE SKIP LOCKED` (`claimEvents`) para reclamo atómico; fallos con backoff exponencial
(`min(300, 2^min(attempt,8)*2)` s) y DEAD_LETTER tras `WORKER_MAX_ATTEMPTS`. `assertWorkerLease`
protege contra doble procesamiento (409). Decisión idempotente: si ya existe, se devuelve.

## Procesamiento asíncrono

`AccessEventRunner` reclama y procesa eventos de la cola. Ver [[07-async-processing/workers]].

## Observabilidad

Worker con logs defensivos (try/catch anidado). Decisiones persistidas con `policyVersion` para
auditoría. `INFERIDO`: métricas de cola no específicas de este módulo.

## Pruebas

- `access-policy.evaluator.spec.ts` — 5 casos (grant activo con scope, expirada, staff sin membresía,
  staff terminado, dirección no permitida). Gaps: `USER_INACTIVE`, `CREDENTIAL_INACTIVE`,
  `DEVICE_INACTIVE`, `SUSPENDED`, `NOT_STARTED`, `ACCESS_SCOPE_DENIED`, match por sala.
- `access-credential.schemas.spec.ts` — PIN acotado, referencia opaca, `.strict()` rechaza `template`
  (anti-fuga biométrica).
- Sin specs de service/repository/worker (`INFERIDO` cobertura vía e2e no presente).

## Riesgos

- `SEC-2` — Ramas de denegación del evaluador sin test: una regresión en el orden de corto-circuito
  pasaría inadvertida.
- Gating del mock solo por env; una mala config en prod expondría el inyector de eventos (ADMIN).
- Contrato con `MembershipRepository` (branchScopes, `plan.accessScopes`) sin test de frontera: un
  cambio ahí altera decisiones silenciosamente (`INFERIDO`).
- `verifyPin`/`resolveExternalReference` sin ruta HTTP: existen para el adaptador futuro (ADR-0002).

## Referencias al código

- `access-control.service.ts` → `enqueueAuthenticatedEvent`, `processEvent`, `assertWorkerLease`.
- `access-control.repository.ts` → `claimEvents`, `markEventFailed`.
- `access-credential.service.ts` → `createPin`, `createExternalReference`, `verifyPin`.
- `access-policy.evaluator.ts` → `evaluateAccessPolicy`.

## Relaciones

[[03-domains/membership/index]] · [[03-domains/facilities/index]] · [[03-domains/integration/index]] ·
[[03-domains/users/index]]
