---
type: data
status: verified
last_reviewed: 2026-08-06
source_revision: 27f3fd2
tags: [backend, data]
---

# Modelo lógico de datos

Entidades, atributos clave, identificadores, cardinalidades e integridad, independiente del motor.
Correlacionado con migraciones y modelos Sequelize.

## Convenciones

- **Identidad:** casi todas las entidades usan clave sustituta `id` UUID (v4). Excepciones:
  `plan_features` (PK compuesta `plan_id + feature_id`), `profile.onboarding` (PK = `user_id`),
  `exercise_dataset_sync_state` (PK = `source_key`).
- **Timestamps:** `created_at` / `updated_at` (`now()`); tablas append-only sin `updated_at`
  (`body_measurements`, `plan_features`, `extensions`, `domain_events`* tienen updated pero mutación
  bloqueada por trigger).
- **`public_id`:** identificador externo/expuesto separado del `id` interno en `plans` e `intents`.
- **Integridad:** garantizada en la base (FK, UK, CHECK, triggers), no solo en la app (regla
  `.claude/rules/80-database.md`).

## Entidades por dominio

### Identidad y perfiles
- **Usuario** (`usuarios`): email (UK), password_hash, nombre, rol, estado. Identificador natural:
  email. Un usuario tiene 0..1 perfil antropométrico, 0..1 perfil de cliente, 0..1 perfil de staff,
  0..1 onboarding, 0..1 preferencia de notificación.
- **Perfil antropométrico** (`perfiles_antropometricos`): edad?, peso, estatura, objetivo. 1:1 con
  usuario (FK UNIQUE).
- **Onboarding** (`profile.onboarding`): estado del flujo, paso actual, metas, consentimientos. 1:1
  con usuario (PK = user_id).
- **Medición corporal** (`profile.body_measurements`): historial append-only de peso; idempotencia
  por `(user_id, idempotency_key)`.

### Membresías (dominio mayor)
- **Plan** (`membership.plans`): code (UK), duración, tipo, precio/moneda, beneficios. 1:N membresías,
  N:M características vía `plan_features`, 1:N scopes de acceso.
- **Característica** (`membership.features`): code (UK). N:M con planes; 1:N derechos.
- **Membresía** (`membership.memberships`): user, plan, starts_on/ends_on, status. N:1 usuario, N:1
  plan. UK de periodo `(user, plan, starts_on, ends_on)`.
- **Derecho / Entitlement** (`membership.entitlements`): user + feature + origen. Unicidad por
  `(user, feature, source_type, source_id)`.
- **Historial de estado** (`membership.status_history`): transición from→to, ligada 1:1 a un
  `domain_event`. Append-only.
- **Intent** (`membership.intents`): renovación/extensión pendiente de pago; idempotencia
  `(user, idempotency_key)`.
- **Extensión** (`membership.extensions`): resultado 1:1 de un intent confirmado; extiende `ends_on`.
- **Perfil de cliente / staff** (`customer_profiles` / `staff_profiles`): 1:1 con usuario. Staff con
  scopes de sucursal (N:M).

### Acceso físico
- **Credencial** (`access_control.credentials`): PIN o biometría (por referencia externa + consentimiento).
  N:1 usuario, con unicidad parcial (un PIN activo; biometría externa única).
- **Dispositivo** (`access_control.devices`): ligado a un punto de acceso.
- **Evento de dispositivo** (`device_events`): cola idempotente `(device, source_event_id)`.
- **Decisión de acceso** (`decisions`): 1:1 con evento; GRANTED/DENIED + reason_code + membresía/staff
  que la justifica.

### Entrenamiento
- **Rutina** → **Rutina-ejercicio** (orden único) → asignada a clientes (**Asignación**, una activa
  por rutina+cliente).
- **Sesión** → **Sesión-ejercicio** (orden único) → **Serie** (número único). Una sesión activa por
  usuario.

### Instalaciones y notificaciones
- **Sucursal** → **Sala** → **Punto de acceso**; **Equipo** asignado a sala (una asignación activa) y
  con **Mantenimientos**.
- **Notificación** → **Intento de entrega**; **Preferencia** 1:1 con usuario.

### Integración
- **Outbox job** ↔ **Domain event** (evento append-only; job puede enlazar 1 evento). **Legacy import
  batch** → **records**.

## Cardinalidades resumidas

Detalle completo con mecanismo y ON DELETE en [[relationship-catalog]]. Reglas de integridad
declaradas en migraciones (ver [[physical-data-model]]).

## Integridad y reglas destacables

- **Exclusividad temporal:** una sesión de entrenamiento activa por usuario; una asignación de rutina
  activa por cliente; una asignación de equipo activa; un PIN activo por usuario (índices únicos
  parciales).
- **Coherencia de dominio:** ejercicio GLOBAL sin creador / PERSONAL con creador; credencial biométrica
  exige consentimiento; notificación externa exige consentimiento y versión.
- **Historiales append-only:** `domain_events` y `membership.status_history` rechazan UPDATE/DELETE
  por trigger.
- **Idempotencia:** claves de deduplicación en outbox, notificaciones, eventos de dispositivo,
  imports legacy, intents y mediciones.

## Referencias

- [[conceptual-data-model]] · [[physical-data-model]] · [[relationship-catalog]] · [[data-dictionary]]
