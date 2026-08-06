---
type: data
status: verified
last_reviewed: 2026-08-06
source_revision: 27f3fd2
tags: [backend, data]
---

# Entidad: notification

## Identidad
- **Tabla:** `notifications.messages` · **Modelo:** `src/modules/notifications/notification.model.ts`
- **PK:** `id` uuid v4

## Definición de negocio
Mensaje dirigido a un usuario, típicamente recordatorio de expiración de membresía. Se entrega por un
canal (in-app, gateway HTTP/WhatsApp o mock) y registra cada intento de entrega.

## Clasificación
Agregado raíz · Dominio notifications · Sensibilidad: media (asunto/cuerpo pueden contener PII).
Ver [[../sensitive-data]].

## Representaciones
- ORM: `NotificationModel` (`BelongsTo` recipient, membership; `HasMany` deliveryAttempts).

## Atributos
| Campo físico | Tipo | Req | Default | Restricción |
|---|---|---|---|---|
| id | uuid | Sí | uuid_v4 | PK |
| recipient_user_id | uuid | Sí | — | FK usuarios RESTRICT |
| membership_id | uuid | No | — | FK memberships SET NULL |
| channel | varchar(30) | Sí | — | CHECK IN_APP/HTTP_GATEWAY/MOCK |
| subject | varchar(240) | No | — | — |
| body | text | Sí | — | — |
| days_remaining | integer | No | — | CHECK ≥0 |
| deduplication_key | varchar(240) | Sí | — | UNIQUE |
| status | varchar(30) | Sí | PENDING | CHECK PENDING/SENT/FAILED/DEAD_LETTER/READ |
| read_at / sent_at | timestamptz | No | — | — |
| metadata | jsonb | Sí | `{}` | — |

## Invariantes
- `deduplication_key` UNIQUE → no se envía el mismo recordatorio dos veces (idempotencia clave para el
  escaneo de expiración).
- Cada `delivery_attempts.attempt_number` es único y creciente por notificación.

## Relaciones
- N:1 → user (RESTRICT), membership (SET NULL). 1:N → delivery-attempt (CASCADE).
  Ver [[../relationship-catalog]] R55–R57.

## Estados
PENDING → SENT → READ; PENDING/SENT → FAILED → DEAD_LETTER. VERIFICADO por CHECK; transiciones
READ/DEAD_LETTER INFERIDO. Ver [[../state-and-lifecycle-models]].

## CRUD
- C: al detectar expiración (dedup). U: worker de entrega actualiza status/sent_at y agrega intento;
  lectura marca `read_at`/READ. D: retención (INFERIDO).

## Eventos
Producida por el flujo de recordatorios (outbox); su entrega la realiza el worker
notification-delivery contra el gateway externo (con consentimiento si canal externo).

## Sensibilidad
Media: `subject`/`body` pueden incluir PII; canal HTTP_GATEWAY exige consentimiento en
`notification-preference`. Ver [[../sensitive-data]].

## Índices
- UK `deduplication_key`; `ix_notifications_recipient_status (recipient_user_id, status, created_at DESC)`
  (bandeja del usuario).

## Riesgos
- **DATA:** entrega externa *at-least-once*; el dedup evita duplicados lógicos pero el proveedor debe
  tolerar reintentos.
- Envío por canal externo sin consentimiento vigente violaría el CHECK de preferencias (bloqueado en
  origen).

## Evidencia
Migración `202607190002` (messages + delivery_attempts); `202607190005`/`202607190006` (preferences +
consentimiento); `notification.model.ts`; enums `NotificationChannel`, `NotificationStatus`.

## Relaciones (wikilinks)
[[entities/user|user]] · [[entities/membership|membership]] · [[entities/outbox-job|outbox-job]] ·
[[03-domains/notifications/index|Dominio Notifications]]
