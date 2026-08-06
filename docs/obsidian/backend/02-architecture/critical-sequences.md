---
title: "Secuencias críticas"
type: architecture
status: verified
last_reviewed: "2026-08-06"
source_revision: "27f3fd2"
tags: [backend, architecture]
---

# Secuencias críticas

Cuatro flujos representativos. Base: `docs/architecture/event-driven-production-audit.md` y
`docs/architecture/flows.md`.

## 1. Login

```mermaid
sequenceDiagram
  participant C as Cliente
  participant A as AuthController
  participant S as AuthService
  participant U as UsersRepository
  C->>A: POST /auth/login (Throttle 10)
  A->>A: ZodValidationPipe
  A->>S: login(input)
  S->>U: buscar por email
  S->>S: bcrypt.compare (gasta compare aunque no exista)
  S-->>A: access + refresh JWT HS256
  A-->>C: tokens
```

Anti-enumeración temporal: el `compare` se ejecuta incluso sin cuenta. Rutas privadas revalidan el
principal en cada request (`JwtAuthGuard`).

## 2. Renovación / activación de membresía + outbox

```mermaid
sequenceDiagram
  participant O as Staff/Admin
  participant M as MembershipService
  participant PG as PostgreSQL (tx)
  participant W as worker-notifications
  participant G as Gateway externo
  O->>M: activar/renovar membresia
  M->>PG: BEGIN
  M->>PG: memberships + status_history
  M->>PG: domain_events (membership.activated.v1)
  M->>PG: outbox_jobs (si hay consumidor)
  M->>PG: COMMIT
  Note over W,PG: mas tarde
  W->>PG: claim outbox (SKIP LOCKED)
  W->>G: entrega HTTPS firmada
  W->>PG: complete / fail+deadletter
```

Mutación y evento en una sola transacción; repetir el mismo estado no genera historial artificial.

## 3. Evento de acceso físico

```mermaid
sequenceDiagram
  participant D as Adapter PACS
  participant Q as device_events
  participant W as worker-access
  participant P as Politica versionada
  D->>Q: AccessDeviceEvent (sourceEventId unico)
  W->>Q: claimEvents (SKIP LOCKED, lease)
  W->>W: valida usuario/credencial activos
  W->>P: evalua (staff sin plan / cliente con membresia+alcance)
  W->>Q: decisions (GRANTED/DENIED + reasonCode)
  W->>Q: access.decision-recorded.v1 + finaliza evento
```

Si la decisión ya existe, el worker completa el evento sin duplicarla (idempotencia). `GRANTED` ≠
paso físico confirmado.

## 4. Entrega de notificación

```mermaid
sequenceDiagram
  participant R as worker-reminders
  participant PG as PostgreSQL
  participant N as worker-notifications
  participant X as IN_APP / HTTP / MOCK
  R->>PG: scan membresias en umbral
  R->>PG: tx: messages + delivery-requested.v1 + outbox (dedup key)
  N->>PG: claim outbox
  N->>X: deliver()
  X-->>N: ok / error
  N->>PG: delivery_attempts + complete | fail(backoff/deadletter)
```

Horas de silencio ajustan `available_at`; el canal externo revalida consentimiento antes de enviar.

Ver [[07-async-processing/events]], [[02-architecture/data-flow]].
