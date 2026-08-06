---
type: data
status: verified
last_reviewed: 2026-08-06
source_revision: 27f3fd2
tags: [backend, data]
---

# Entidad: membership

## Identidad
- **Tabla:** `membership.memberships` · **Modelo:** `src/modules/membership/membership.model.ts`
- **PK:** `id` uuid v4

## Definición de negocio
Contrato de acceso de un usuario a un plan durante un periodo (`starts_on`–`ends_on`). Eje del
negocio: habilita el acceso físico y motiva recordatorios de expiración.

## Clasificación
Agregado raíz · Dominio membership · Sensibilidad: baja (referencias externas y notas administrativas
son media). Ver [[../sensitive-data]].

## Representaciones
- ORM: `MembershipModel` (`BelongsTo` user, plan, createdByUser).
- API vía mapper.

## Atributos
| Campo físico | Tipo | Req | Default | Restricción |
|---|---|---|---|---|
| id | uuid | Sí | uuid_v4 | PK |
| user_id | uuid | Sí | — | FK usuarios RESTRICT |
| plan_id | uuid | Sí | — | FK plans RESTRICT |
| starts_on / ends_on | date | Sí | — | CHECK ends≥starts |
| status | varchar(30) | Sí | ACTIVE | CHECK ACTIVE/SUSPENDED/CANCELLED/EXPIRED |
| external_reference | varchar(180) | No | — | UK parcial |
| notes | text | No | — | — |
| created_by_user_id | uuid | No | — | FK usuarios SET NULL |
| cancelled_at / suspended_at | timestamptz | No | — | — |
| metadata | jsonb | Sí | `{}` | — |

## Invariantes
- `ends_on ≥ starts_on`.
- UK de periodo `(user_id, plan_id, starts_on, ends_on)` evita duplicar el mismo contrato.
- `external_reference` única (parcial) para conciliación con sistemas externos.

## Relaciones
- N:1 → user (RESTRICT), plan (RESTRICT), createdByUser (SET NULL).
- 1:N → membership-status-history, membership-extension; referenciada (SET NULL) por access-decision y
  notification; referenciada (SET NULL) por membership-intent. Ver [[../relationship-catalog]] R26–R28, R44, R41, R53, R56.

## Estados
ACTIVE, SUSPENDED, CANCELLED, EXPIRED (VERIFICADO por CHECK). Cada transición se registra en
`status_history` (append-only, 1:1 con `domain_event`). Grafo de transición: INFERIDO — ver
[[../state-and-lifecycle-models]].

## CRUD
- C: alta de membresía (transacción con historial + evento + outbox). U: cambios de estado, extensión
  (`ends_on`). D: no físico; se cancela (CANCELLED) o expira (EXPIRED).

## Eventos
Alta y cada cambio de estado emiten `domain_event` + `outbox_job` atómicamente; el historial referencia
el evento (`status_history.domain_event_id` UNIQUE). Ver [[../transactions]].

## Sensibilidad
Baja; `notes` y `external_reference` pueden contener datos operativos (media).

## Índices
- UK periodo; UK parcial external_reference; `ix_memberships_user_status_dates`;
  `ix_memberships_expiration_scan (status, ends_on) WHERE status='ACTIVE'` (recordatorios).

## Riesgos
- **DATA:** el escaneo de expiración depende del índice parcial; si `status` no se mantiene coherente
  con `ends_on`, se pierden o duplican recordatorios (dedup de notificación mitiga).
- Historial append-only: correcciones exigen nuevo evento, no edición.

## Evidencia
Migraciones `202607190001` (tabla), `202607190006` (status_history + trigger), `202607220002`
(intents/extensions); `membership.model.ts`; enum `MembershipStatus`.

## Relaciones (wikilinks)
[[entities/user|user]] · [[entities/entitlement|entitlement]] · [[../data-dictionary]] ·
[[03-domains/membership/index|Dominio Membership]]
