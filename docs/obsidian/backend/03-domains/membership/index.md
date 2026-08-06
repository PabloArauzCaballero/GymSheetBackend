---
title: "Membership"
type: domain
status: verified
criticality: high
last_reviewed: "2026-08-06"
source_revision: "27f3fd2"
domain: "membership"
source_files: [
  "src/modules/membership/membership.controller.ts",
  "src/modules/membership/membership.service.ts",
  "src/modules/membership/customer-staff.service.ts",
  "src/modules/membership/membership.repository.ts",
  "src/modules/membership/membership.schemas.ts",
  "src/modules/membership/membership.module.ts"
]
tags: [backend, domain]
related: ["[[03-domains/access-control/index]]", "[[03-domains/notifications/index]]", "[[03-domains/integration/index]]"]
---

# Membership

## Resumen

Dominio núcleo y el más grande. Gestiona el ciclo de vida comercial: planes con scopes de acceso,
membresías de clientes, intents de renovación/extensión (canal WhatsApp), entitlements efectivos,
alta de clientes y perfiles de staff con scopes por sucursal. Es la fuente de verdad que consume
`access-control` para autorizar el acceso físico.

## Responsabilidad

- CRUD de planes (`MembershipPlanModel`) y sus scopes (`PlanAccessScopeModel`, sucursal/sala).
- Alta y transición de estado de membresías, con historial auditable.
- Flujo de intents (renovación/extensión) idempotente y su confirmación tras pago.
- Cálculo de accesos efectivos (features de plan + entitlements explícitos).
- Alta de clientes (usuario + perfil + credencial PIN + preferencia de notificación) y de staff.

## Límites

- No procesa pagos: `confirmIntent` asume el pago externo confirmado (ADMIN).
- No decide el acceso físico; solo provee datos (staff scopes, membresía vigente) a `access-control`.
- No entrega notificaciones; genera URL de WhatsApp y delega en `notifications`.

## Entradas

- HTTP autenticado (cliente `/me/*`, admin `/admin/membership/*`), validado por Zod
  (`membership.schemas.ts`) y `UuidParamPipe`.
- Consumo interno desde `access-control` (`MembershipRepository.findStaffByUserId`,
  `findCurrentMembership`).

## Salidas

- DTOs en español vía `membership.mapper.ts` (nunca modelos ORM directos).
- Domain events en `integration.domain_events`.
- URLs de WhatsApp para renovación (`buildMembershipWhatsAppUrl`,
  `MEMBERSHIP_RENEWAL_MESSAGE`).

## Casos de uso

- Cliente: ver su membresía y proyección, accesos efectivos, opciones de compra/renovación/extensión,
  crear intents.
- ADMIN/FRONT_DESK: administrar planes, clientes, membresías, staff, y confirmar intents.

## Reglas de negocio

- `endsOn = startsOn + durationDays - 1` en alta (`createMembership`).
- Una membresía CANCELLED no puede reactivarse → 409 (`changeMembershipStatus`).
- Extensión requiere membresía ACTIVA del mismo plan; `confirmIntent` extiende sumando
  `durationDays * months`.
- `effectiveStatus` deriva EXPIRED cuando ACTIVE pero `endsOn < hoy` (comparación ISO `YYYY-MM-DD`).
- Intents idempotentes por `idempotencyKey`; `UniqueConstraintError` → 409.
- Accesos efectivos: se fusionan features del plan y entitlements explícitos, dedup por `code`.

## Componentes principales

| Componente | Tipo | Responsabilidad | Evidencia |
|---|---|---|---|
| `MembershipController` / `MembershipStoreController` / `AdminMembershipController` | Controllers | Rutas cliente/store/admin | `membership.controller.ts` |
| `MembershipService` | Service | Planes, membresías, intents, proyección, accesos | `membership.service.ts` |
| `CustomerStaffService` | Service | Alta de clientes y ciclo de vida de staff | `customer-staff.service.ts` |
| `MembershipRepository` | Repository | Persistencia + locks `FOR UPDATE` acotados | `membership.repository.ts` |
| `BusinessDateService` | Service | Aritmética de fechas de negocio | `membership.module.ts` |

## Entidades y datos

13 modelos `*.model.ts`: `MembershipModel`, `MembershipPlanModel`, `PlanAccessScopeModel`,
`PlanFeatureModel`, `MembershipFeatureModel`, `EntitlementModel`, `MembershipIntentModel`,
`MembershipExtensionModel`, `MembershipStatusHistoryModel`, `CustomerProfileModel`,
`StaffProfileModel`, `StaffBranchScopeModel`, `MediaFileModel`. (El contexto menciona "18 modelos";
`INFERIDO` incluye modelos referenciados de otros esquemas como `UserModel`/`BranchModel`.)
Detalle: [[05-data/index]].

## Endpoints o contratos

- `GET /memberships/me`; store: `GET /membership/plans`, `/membership/plans/:id`, `/me/membership`,
  `/me/accesses`, `/me/membership/options`, `POST /me/membership/renewal-intent`,
  `/me/membership/extension-intent`.
- Admin (`/admin/membership/*`): planes (list/create/update/scopes), clientes (create/list),
  memberships (create/list/status), staff (create/status), `intents/:id/confirm`.
- Resumen y contrato: [[04-api/index]].

## Eventos

Vía `DomainEventPublisher.record(...)` dentro de la transacción: `MEMBERSHIP_ACTIVATED`,
`MEMBERSHIP_STATUS_CHANGED`, `CUSTOMER_REGISTERED`, `STAFF_PROFILE_CREATED`, `STAFF_STATUS_CHANGED`.
`INFERIDO/RIESGO`: usa `record`, no `recordAndEnqueue` → los eventos se persisten pero **no se
encolan** al outbox; `confirmIntent` no emite evento ni historial. Ver [[03-domains/integration/index]].

## Dependencias

`AccessCredentialModule` (PIN), `FacilitiesModule` (validar sucursal/sala), `IntegrationModule`
(publisher), `NotificationsModule` (preferencia por defecto), `UsersModule`.

## Autenticación y permisos

Guards globales + `@Roles`. Admin restringido a ADMIN+FRONT_DESK; plan/staff/confirm a ADMIN. Rutas
`/me/*` scopeadas por `@CurrentUser().id`. Recurso ausente/ajeno → 404 (`NotFoundException`).

## Manejo de errores

`NotFoundException` (plan/membresía/intent/perfil), `ConflictException` (reactivar cancelada,
cliente/staff duplicado, intent no pendiente, unicidad), `UnprocessableEntityException` (rol
inválido, plan inactivo, precondición de extensión, sucursal/sala inexistente).

## Transacciones y consistencia

`sequelize.transaction` envuelve create/update de plan, membresía, cambio de estado, intents y todas
las escrituras de `CustomerStaffService`. Locks `LOCK.UPDATE` (`FOR UPDATE`) con `of:<Model>` para
evitar el problema de PostgreSQL con el lado nullable de LEFT JOIN (motivo del branch
`seed-and-lock`). `confirmIntent` bloquea intent y luego membresía, serializando el sembrado/extensión
por usuario.

## Procesamiento asíncrono

Sin worker propio. Recordatorios de expiración los ejecuta `notifications`
([[07-async-processing/workers]]).

## Observabilidad

Sin métricas propias; los eventos alimentan el log de `integration`. `INFERIDO`: no hay logging
estructurado específico observado en el servicio.

## Pruebas

- `membership-renewal.spec.ts` — `buildMembershipWhatsAppUrl` + mensaje codificado.
- `membership.schemas.spec.ts` — normalización de `createCustomerSchema`, PIN requerido, dedup de días
  de recordatorio en `createPlanSchema`.
- Gap: sin tests de `confirmIntent`, transiciones de estado, locking ni entitlements.

## Riesgos

- `ARCH-1` — Eventos no encolados al outbox (solo `record`); `confirmIntent` sin evento ni historial:
  una renovación/extensión pagada no queda auditada por eventos.
- `DATA-1` — `endsOn` inclusivo/exclusivo difiere entre alta (`-1`) y extensión (sin `-1`): posible
  deriva de un día.
- Carrera en `createIntent`: dedup depende de unicidad de `idempotencyKey`; verificar índice único en
  migración (`INFERIDO` no declarado en el modelo).
- Clave de dedup de cambio de estado incluye `randomUUID()` → reintentos nunca deduplicados.

## Referencias al código

- `membership.service.ts` → `createMembership`, `changeMembershipStatus`, `createIntent`,
  `confirmIntent`, `getMyAccesses`, `effectiveStatus`.
- `customer-staff.service.ts` → `createCustomer`, `createStaff`, `updateStaffStatus`.
- `membership.repository.ts` → `findPlan`, `findLatestMembership`, `findIntentByKey` (locks).
- `membership.schemas.ts` → `createPlanSchema`, `membershipIntentSchema`, `createStaffSchema`.

## Relaciones

[[03-domains/access-control/index]] · [[03-domains/notifications/index]] ·
[[03-domains/integration/index]] · [[03-domains/facilities/index]] · [[03-domains/users/index]]
