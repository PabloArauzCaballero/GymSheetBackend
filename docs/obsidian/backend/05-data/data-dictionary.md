---
type: data
status: verified
last_reviewed: 2026-08-06
source_revision: 27f3fd2
tags: [backend, data]
---

# Diccionario de datos (entidades críticas)

Diccionario navegable de las entidades críticas. Tipos y restricciones desde migraciones; nombres de
propiedad TypeScript desde los modelos Sequelize. Sensibilidad: ver [[sensitive-data]].

## user — `public.usuarios`

| Atributo | Campo físico | Tipo | Req | Default | Restricción | Sensib. | Descripción |
|---|---|---|---|---|---|---|---|
| id | id | uuid | Sí | uuid_v4 | PK | Baja | Identidad interna |
| email | email | varchar(180) | Sí | — | UNIQUE | PII | Identificador de login |
| passwordHash | password_hash | varchar(255) | Sí | — | — | **Credencial** | Hash bcrypt; nunca se expone |
| fullName | nombre_completo | varchar(180) | Sí | — | — | PII | Nombre del usuario |
| role | rol | varchar(30) | Sí | CLIENTE | CHECK 5 valores | Baja | ADMIN/CLIENTE/ENTRENADOR_EXTERNO/COACH/FRONT_DESK |
| status | estado | varchar(20) | Sí | ACTIVO | CHECK 2 valores | Baja | ACTIVO/INACTIVO |
| registeredAt | fecha_registro | timestamptz | Sí | now() | — | Baja | Alta del usuario |

> Contradicción: el modelo declara `role`/`status` como `DataType.ENUM`, pero físicamente son
> varchar+CHECK (ver [[physical-data-model]]).

## membership — `membership.memberships`

| Atributo | Campo físico | Tipo | Req | Default | Restricción | Sensib. | Descripción |
|---|---|---|---|---|---|---|---|
| id | id | uuid | Sí | uuid_v4 | PK | Baja | Identidad |
| userId | user_id | uuid | Sí | — | FK usuarios RESTRICT | Baja | Titular |
| planId | plan_id | uuid | Sí | — | FK plans RESTRICT | Baja | Plan contratado |
| startsOn | starts_on | date | Sí | — | CHECK ends≥starts | Baja | Inicio de vigencia |
| endsOn | ends_on | date | Sí | — | CHECK ends≥starts | Baja | Fin de vigencia |
| status | status | varchar(30) | Sí | ACTIVE | CHECK 4 valores | Baja | ACTIVE/SUSPENDED/CANCELLED/EXPIRED |
| externalReference | external_reference | varchar(180) | No | — | UK parcial | Baja | Referencia de sistema externo |
| notes | notes | text | No | — | — | Media | Notas administrativas |
| createdByUserId | created_by_user_id | uuid | No | — | FK usuarios SET NULL | Baja | Staff que la creó |
| cancelledAt / suspendedAt | idem | timestamptz | No | — | — | Baja | Marcas de estado |
| metadata | metadata | jsonb | Sí | `{}` | — | Media | Datos flexibles |

UK de periodo `(user_id, plan_id, starts_on, ends_on)`.

## membership-plan — `membership.plans`

| Atributo | Campo físico | Tipo | Req | Default | Restricción | Sensib. | Descripción |
|---|---|---|---|---|---|---|---|
| id | id | uuid | Sí | uuid_v4 | PK | Baja | Identidad interna |
| publicId | public_id | uuid | Sí | uuid_v4 | UNIQUE | Baja | Identificador expuesto |
| code | code | varchar(80) | Sí | — | UNIQUE | Baja | Código de negocio |
| name | name | varchar(180) | Sí | — | — | Baja | Nombre comercial |
| durationDays | duration_days | integer | Sí | — | CHECK 1–3650 | Baja | Duración base |
| planType | plan_type | varchar(30) | Sí | CUSTOM | CHECK 7 valores | Baja | DAY_PASS…ANNUAL/CUSTOM |
| priceAmount / currency | price_amount / currency | numeric(12,2) / char(3) | No | — | CHECK moneda `^[A-Z]{3}$` | Financiero | Precio y divisa |
| reminderDays | reminder_days | jsonb | Sí | `[7,3,1,0]` | CHECK array | Baja | Días de recordatorio |
| benefits | benefits | jsonb | Sí | `[]` | CHECK array | Baja | Beneficios mostrados |
| status | status | varchar(20) | Sí | ACTIVE | CHECK 2 | Baja | ACTIVE/INACTIVE |
| available* | available_new/renewal/extension | boolean | Sí | true | — | Baja | Disponibilidad comercial |
| imageFileId | image_file_id | uuid | No | — | FK media.files SET NULL | Baja | Imagen del plan |

## entitlement — `membership.entitlements`

| Atributo | Campo físico | Tipo | Req | Default | Restricción | Sensib. | Descripción |
|---|---|---|---|---|---|---|---|
| id | id | uuid | Sí | uuid_v4 | PK | Baja | Identidad |
| userId | user_id | uuid | Sí | — | FK usuarios CASCADE | Baja | Beneficiario |
| featureId | feature_id | uuid | Sí | — | FK features RESTRICT | Baja | Característica habilitada |
| sourceType | source_type | varchar(24) | Sí | — | CHECK 5 valores | Baja | MEMBERSHIP/PURCHASE/ADMIN_GRANT/PROMOTION/TRIAL |
| sourceId | source_id | uuid | Sí | — | UK origen | Baja | Origen concreto |
| status | status | varchar(20) | Sí | ACTIVE | CHECK 3 | Baja | ACTIVE/REVOKED/EXPIRED |
| startsAt | starts_at | timestamptz | Sí | — | CHECK ends≥starts | Baja | Inicio de vigencia |
| endsAt | ends_at | timestamptz | No | — | — | Baja | Fin (NULL = indefinido) |
| metadata | metadata | jsonb | Sí | `{}` | — | Baja | Datos flexibles |

UK `(user_id, feature_id, source_type, source_id)`.

## access-credential — `access_control.credentials`

| Atributo | Campo físico | Tipo | Req | Default | Restricción | Sensib. | Descripción |
|---|---|---|---|---|---|---|---|
| id | id | uuid | Sí | uuid_v4 | PK | Baja | Identidad |
| userId | user_id | uuid | Sí | — | FK usuarios RESTRICT | Baja | Dueño |
| credentialType | credential_type | varchar(30) | Sí | — | CHECK PIN/FACE/FINGERPRINT | **Biométrico** | Tipo de credencial |
| provider | provider | varchar(100) | Sí | — | — | Baja | Proveedor/adaptador |
| pinHash | pin_hash | varchar(255) | No | — | CHECK material | **Credencial** | Hash de PIN (solo tipo PIN) |
| externalReference | external_reference | varchar(255) | No | — | CHECK material; UK parcial | **Biométrico** | Referencia externa (biometría, NO plantilla) |
| status | status | varchar(30) | Sí | ACTIVE | CHECK 3 | Baja | ACTIVE/SUSPENDED/REVOKED |
| consentVersion | consent_version | varchar(80) | No | — | CHECK material | Media | Versión de consentimiento |
| consentRecordedAt | consent_recorded_at | timestamptz | No | — | CHECK material | Media | Fecha de consentimiento (obligatorio en biometría) |
| enrolledAt | enrolled_at | timestamptz | Sí | now() | — | Baja | Alta |
| lastVerifiedAt / revokedAt | idem | timestamptz | No | — | — | Baja | Trazas |
| revocationReason | revocation_reason | text | No | — | — | Media | Motivo de revocación |
| metadata | metadata | jsonb | Sí | `{}` | — | Media | Datos flexibles |

CHECK `ck_credentials_material`: PIN ⇒ pin_hash + sin external_ref; FACE/FINGERPRINT ⇒ external_ref +
consent + sin pin_hash. **No se almacenan plantillas biométricas**, solo referencias externas.

## access-decision — `access_control.decisions`

| Atributo | Campo físico | Tipo | Req | Default | Restricción | Sensib. | Descripción |
|---|---|---|---|---|---|---|---|
| id | id | uuid | Sí | uuid_v4 | PK | Baja | Identidad |
| deviceEventId | device_event_id | uuid | Sí | — | FK event UNIQUE | Baja | Evento resuelto (1:1) |
| userId | user_id | uuid | Sí | — | FK usuarios RESTRICT | Baja | Sujeto |
| outcome | outcome | varchar(20) | Sí | — | CHECK GRANTED/DENIED | Baja | Resultado |
| reasonCode | reason_code | varchar(60) | Sí | — | — | Baja | Motivo (enum lógico, ver AccessDecisionReason) |
| membershipId | membership_id | uuid | No | — | FK SET NULL | Baja | Membresía que otorgó |
| staffProfileId | staff_profile_id | uuid | No | — | FK SET NULL | Baja | Staff que otorgó |
| daysRemaining | days_remaining | integer | No | — | CHECK ≥0 | Baja | Días restantes |
| decidedAt | decided_at | timestamptz | Sí | now() | — | Baja | Momento de decisión |
| policyVersion | policy_version | varchar(80) | Sí | — | — | Baja | Versión de política aplicada |

## outbox-job — `integration.outbox_jobs`

| Atributo | Campo físico | Tipo | Req | Default | Restricción | Sensib. | Descripción |
|---|---|---|---|---|---|---|---|
| id | id | uuid | Sí | uuid_v4 | PK | Baja | Identidad |
| queueName | queue_name | varchar(120) | Sí | — | índice claim | Baja | Cola lógica |
| eventType | event_type | varchar(160) | Sí | — | — | Baja | Tipo de evento |
| aggregateType | aggregate_type | varchar(120) | Sí | — | — | Baja | Agregado origen |
| aggregateId | aggregate_id | uuid | No | — | — | Baja | Id del agregado |
| domainEventId | domain_event_id | uuid | No | — | FK domain_events RESTRICT | Baja | Evento respaldado |
| deduplicationKey | deduplication_key | varchar(240) | Sí | — | UNIQUE | Baja | Idempotencia |
| payload | payload | jsonb | Sí | — | CHECK object | Media | Carga del evento |
| status | status | varchar(30) | Sí | PENDING | CHECK 5 | Baja | PENDING/PROCESSING/COMPLETED/FAILED/DEAD_LETTER |
| attemptCount / maxAttempts | idem | integer | Sí | 0 / 5 | CHECK max 1–20 | Baja | Reintentos |
| availableAt | available_at | timestamptz | Sí | now() | índice claim | Baja | Backoff/visibilidad |
| lockedAt / lockedBy | idem | timestamptz/varchar | No | — | — | Baja | Claim de worker |
| processedAt | processed_at | timestamptz | No | — | — | Baja | Fin de proceso |
| lastError | last_error | text | No | — | — | Media | Último error (sin secretos) |
| traceId | trace_id | varchar(128) | No | — | — | Baja | Correlación |

## domain-event — `integration.domain_events`

| Atributo | Campo físico | Tipo | Req | Default | Restricción | Sensib. | Descripción |
|---|---|---|---|---|---|---|---|
| id | id | uuid | Sí | uuid_v4 | PK | Baja | Identidad |
| eventName | event_name | varchar(160) | Sí | — | índice | Baja | Nombre del evento |
| eventVersion | event_version | smallint | Sí | — | CHECK >0 | Baja | Versión del contrato |
| aggregateType / aggregateId | idem | varchar/uuid | Sí/No | — | índice | Baja | Agregado |
| deduplicationKey | deduplication_key | varchar(240) | Sí | — | UNIQUE | Baja | Idempotencia |
| actorUserId | actor_user_id | uuid | No | — | FK RESTRICT | Baja | Autor |
| correlationId / causationEventId / traceId | idem | varchar/uuid | No | — | FK self RESTRICT | Baja | Trazabilidad causal |
| occurredAt | occurred_at | timestamptz | Sí | now() | — | Baja | Momento |
| payload / metadata | idem | jsonb | Sí | — / `{}` | CHECK object | Media | Carga; **append-only (trigger)** |

## notification — `notifications.messages`

| Atributo | Campo físico | Tipo | Req | Default | Restricción | Sensib. | Descripción |
|---|---|---|---|---|---|---|---|
| id | id | uuid | Sí | uuid_v4 | PK | Baja | Identidad |
| recipientUserId | recipient_user_id | uuid | Sí | — | FK usuarios RESTRICT | Baja | Destinatario |
| membershipId | membership_id | uuid | No | — | FK SET NULL | Baja | Membresía relacionada |
| channel | channel | varchar(30) | Sí | — | CHECK IN_APP/HTTP_GATEWAY/MOCK | Baja | Canal |
| subject | subject | varchar(240) | No | — | — | Media | Asunto |
| body | body | text | Sí | — | — | Media | Contenido (puede incluir PII) |
| daysRemaining | days_remaining | integer | No | — | CHECK ≥0 | Baja | Días a expirar |
| deduplicationKey | deduplication_key | varchar(240) | Sí | — | UNIQUE | Baja | Idempotencia |
| status | status | varchar(30) | Sí | PENDING | CHECK 5 | Baja | PENDING/SENT/FAILED/DEAD_LETTER/READ |
| readAt / sentAt | idem | timestamptz | No | — | — | Baja | Trazas de entrega/lectura |
| metadata | metadata | jsonb | Sí | `{}` | — | Media | Datos flexibles |

## routine — `training.routines`

| Atributo | Campo físico | Tipo | Req | Default | Restricción | Sensib. | Descripción |
|---|---|---|---|---|---|---|---|
| id | id | uuid | Sí | — | PK | Baja | Identidad |
| nombre | nombre | varchar(160) | Sí | — | — | Baja | Nombre |
| descripcion | descripcion | text | No | — | — | Baja | Descripción |
| createdByUserId | created_by_user_id | uuid | Sí | — | FK usuarios CASCADE | Baja | Autor (coach/cliente) |
| visibilidad | visibilidad | varchar(20) | Sí | PRIVATE | CHECK PRIVATE/SHARED/TEMPLATE | Baja | Alcance |
| objetivo | objetivo | varchar(30) | No | — | CHECK 6 valores | Baja | Objetivo de entrenamiento |
| estado | estado | varchar(20) | Sí | ACTIVE | CHECK ACTIVE/ARCHIVED | Baja | Ciclo de vida |
| metadata | metadata | jsonb | Sí | `{}` | — | Baja | Datos flexibles |

## workout-session — `public.sesiones_entrenamiento`

| Atributo | Campo físico | Tipo | Req | Default | Restricción | Sensib. | Descripción |
|---|---|---|---|---|---|---|---|
| id | id | uuid | Sí | uuid_v4 | PK | Baja | Identidad |
| usuarioId | usuario_id | uuid | Sí | — | FK usuarios CASCADE | Baja | Dueño |
| fechaInicio | fecha_inicio | timestamptz | Sí | now() | — | Baja | Inicio |
| fechaFin | fecha_fin | timestamptz | No | — | CHECK fin≥inicio | Baja | Fin |
| estado | estado | varchar(30) | Sí | EN_PROGRESO | CHECK 3; UK parcial activa | Baja | EN_PROGRESO/FINALIZADA/CANCELADA |
| observacion | observacion | text | No | — | — | Media | Notas |
| routineId / routineAssignmentId | idem | uuid | No | — | FK training.* SET NULL | Baja | Origen de la sesión |

## Referencias

- [[physical-data-model]] · [[sensitive-data]] · [[relationship-catalog]] · entidades en `entities/`
