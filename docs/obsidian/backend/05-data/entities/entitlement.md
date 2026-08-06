---
type: data
status: verified
last_reviewed: 2026-08-06
source_revision: 27f3fd2
tags: [backend, data]
---

# Entidad: entitlement

## Identidad
- **Tabla:** `membership.entitlements` · **Modelo:** `src/modules/membership/entitlement.model.ts`
- **PK:** `id` uuid v4

## Definición de negocio
Derecho efectivo de un usuario sobre una **característica** (feature), con un origen trazable
(membresía, compra, concesión admin, promoción o prueba). Materializa qué puede hacer un usuario más
allá de tener una membresía activa.

## Clasificación
Entidad · Dominio membership · Sensibilidad: baja. Ver [[../sensitive-data]].

## Representaciones
- ORM: `EntitlementModel` (FK user, feature). Nota: el modelo omite algunos `allowNull`/defaults que sí
  están en la migración (la base los impone).

## Atributos
| Campo físico | Tipo | Req | Default | Restricción |
|---|---|---|---|---|
| id | uuid | Sí | uuid_v4 | PK |
| user_id | uuid | Sí | — | FK usuarios CASCADE |
| feature_id | uuid | Sí | — | FK features RESTRICT |
| source_type | varchar(24) | Sí | — | CHECK MEMBERSHIP/PURCHASE/ADMIN_GRANT/PROMOTION/TRIAL |
| source_id | uuid | Sí | — | parte de UK |
| status | varchar(20) | Sí | ACTIVE | CHECK ACTIVE/REVOKED/EXPIRED |
| starts_at | timestamptz | Sí | — | CHECK ends≥starts |
| ends_at | timestamptz | No | — | NULL = indefinido |
| metadata | jsonb | Sí | `{}` | — |

## Invariantes
- UK `(user_id, feature_id, source_type, source_id)`: no duplicar el mismo derecho del mismo origen.
- `ends_at ≥ starts_at` si existe.

## Relaciones
- N:1 → user (CASCADE), membership-feature (RESTRICT). El `source_id` apunta polimórficamente al origen
  (p.ej. una membership) — **no** es una FK declarada (integridad de origen a cargo de la app).
  Ver [[../relationship-catalog]] R36–R37.

## Estados
ACTIVE → REVOKED / EXPIRED (VERIFICADO por CHECK; transición INFERIDO).

## CRUD
- C: al activarse una membresía/compra (transacción). U: revocar/expirar. D: no físico (status).

## Eventos
Concesión/revocación pueden emitir eventos (INFERIDO por patrón outbox).

## Sensibilidad
Baja.

## Índices
- UK de origen; `ix_entitlements_user_active (user_id, status, ends_at)` (derechos vigentes).

## Riesgos
- **DATA:** `source_id` sin FK → posible referencia colgante si el origen se borra (mitigado porque
  memberships usan RESTRICT). Verificar consistencia en la app. INFERIDO.
- **DATA:** consultas "entitlements por feature" carecen de índice que empiece por `feature_id`
  (los existentes empiezan por `user_id`). Ver [[../indexing-and-query-patterns]].

## Evidencia
Migración `202607220002` (tabla + CHECK + UK + índice); `entitlement.model.ts`; enum `EntitlementSource`.

## Relaciones (wikilinks)
[[entities/membership|membership]] · [[entities/user|user]] · [[../data-dictionary]] ·
[[03-domains/membership/index|Dominio Membership]]
