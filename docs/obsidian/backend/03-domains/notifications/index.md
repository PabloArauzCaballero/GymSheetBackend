---
title: "Notifications"
type: domain
status: verified
criticality: medium
last_reviewed: "2026-08-06"
source_revision: "27f3fd2"
domain: "notifications"
source_files: [
  "src/modules/notifications/notification.controller.ts",
  "src/modules/notifications/notification.service.ts",
  "src/modules/notifications/notification-delivery.service.ts",
  "src/modules/notifications/membership-reminder.service.ts",
  "src/modules/notifications/notification-schedule.service.ts",
  "src/modules/notifications/delivery/notification-adapter.factory.ts"
]
tags: [backend, domain]
related: ["[[03-domains/membership/index]]", "[[03-domains/integration/index]]"]
---

# Notifications

## Resumen

Preferencias de notificación, mensajes in-app, recordatorios de expiración de membresía y entrega vía
adaptadores (in-app, gateway HTTP firmado, mock). Produce jobs al outbox; el worker de entrega los
consume.

## Responsabilidad

- Listar/leer notificaciones propias y gestionar preferencias (canal, quiet hours, consentimiento).
- Escanear membresías por expirar y encolar recordatorios idempotentes.
- Entregar mensajes vía el adaptador según canal/provider.

## Límites

- No conoce reglas de membresía más allá de la consulta de expiración (SQL a `membership.*`).
- No implementa WhatsApp directamente: usa un gateway HTTP genérico firmado (`INFERIDO`: WhatsApp es el
  downstream previsto).

## Entradas

- HTTP autenticado (`/notifications/*`), Zod.
- Jobs de outbox (cola `notifications.delivery`) para el worker de entrega.

## Salidas

- `NotificationModel` (mensajes), `DeliveryAttemptModel` (intentos), domain event
  `notification.delivery-requested`.

## Casos de uso

- Usuario: ver notificaciones, marcarlas leídas, ver/actualizar preferencia.
- Worker: entregar mensajes; escanear recordatorios de membresía.

## Reglas de negocio

- `updateMyPreference` rechaza canal `HTTP_GATEWAY` (422) salvo provider HTTP_GATEWAY/MOCK.
- `deliver` idempotente: salta si ya SENT/READ; escribe intento en transacción con re-lock `FOR UPDATE`.
- `nextAllowedAt`: difiere por quiet hours (respeta `BUSINESS_TIME_ZONE`, ventanas nocturnas, +1s tras
  fin de ventana).
- `scan`: dedup por clave; `UniqueConstraintError` → cuenta duplicado (idempotente).
- Canal externo solo si hay consentimiento + versión; si no, IN_APP.

## Componentes principales

| Componente | Tipo | Responsabilidad | Evidencia |
|---|---|---|---|
| `NotificationService` | Service | Listar/leer, preferencias | `notification.service.ts` |
| `NotificationDeliveryService` | Service | Entrega + registro de intento | `notification-delivery.service.ts` |
| `MembershipReminderService` | Service | Escaneo y encolado de recordatorios | `membership-reminder.service.ts` |
| `NotificationScheduleService` | Service | Quiet hours / diferimiento | `notification-schedule.service.ts` |
| `NotificationAdapterFactory` | Factory | Selección de adaptador por canal | `delivery/notification-adapter.factory.ts` |
| Adaptadores | Adapters | in-app / http-gateway / mock | `delivery/*.adapter.ts` |

## Entidades y datos

Esquema `notifications`: `NotificationModel` (messages; dedup key, status, readAt/sentAt),
`NotificationPreferenceModel` (preferences; canal, consentimiento externo, quiet hours),
`DeliveryAttemptModel` (delivery_attempts; provider, status SENT/FAILED). Detalle: [[05-data/index]].

## Endpoints o contratos

`GET /notifications/me`, `PATCH /notifications/:id/read`, `GET /notifications/preferences/me`,
`PATCH /notifications/preferences/me`. [[04-api/index]].

## Eventos

Publica `notification.delivery-requested.v1` y encola a la cola `notifications.delivery` vía
`DomainEventPublisher.recordAndEnqueue`. Ver [[03-domains/integration/index]].

## Dependencias

`IntegrationModule` (outbox/publisher), `BusinessDateService`, `MembershipModel`, `UserModel`; SQL a
`membership.*`.

## Autenticación y permisos

Rutas autenticadas, scopeadas por `user.id`; acceso ajeno → 404. Worker sin auth HTTP. Canal externo
gated por consentimiento + env provider.

## Manejo de errores

404 (notificación ausente/ajena), 422 (canal externo no soportado), `UniqueConstraintError`→duplicado
(sin lanzar). Gateway HTTP mapea fallos a 503; factory lanza 503 para canal no soportado/no
configurado.

## Transacciones y consistencia

`deliver` re-bloquea la fila (`FOR UPDATE`) en transacción antes de cambiar estado. `scan` crea
mensaje + encola en transacción por candidato.

## Procesamiento asíncrono

`NotificationDeliveryRunner` (cola `notifications.delivery`) y `MembershipReminderRunner` (scan
periódico). Ver [[07-async-processing/workers]].

## Observabilidad

Intentos de entrega registrados (`DeliveryAttemptModel`) con provider/código de respuesta.

## Pruebas

`notification-schedule.service.spec.ts`: diferimiento nocturno (+1s), diurno, no-op fuera de quiet
hours. Sin specs de delivery/reminder observadas.

## Riesgos

- Gateway HTTP: HMAC cubre `timestamp.body`; sin ventana de replay explícita (responsabilidad
  downstream).
- `updateMyPreference` permite HTTP_GATEWAY (validado por schema + env), pero el consentimiento no se
  re-verifica en entrega directa (`INFERIDO` bajo: solo el scan produce mensajes externos).
- `daysRemaining` calculado en SQL (`ends_on - today`): posible deriva de zona horaria (`INFERIDO`).

## Referencias al código

- `notification-delivery.service.ts` → `deliver`, `recordFailure`.
- `membership-reminder.service.ts` → `scan`.
- `notification.repository.ts` → `findExpiringMemberships` (raw SQL).
- `delivery/http-gateway-notification.adapter.ts` → firma HMAC, timeout, `redirect:'error'`.

## Relaciones

[[03-domains/membership/index]] · [[03-domains/integration/index]] · [[03-domains/health/index]]
