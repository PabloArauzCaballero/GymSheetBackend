---
type: data
status: inferred
last_reviewed: 2026-08-06
source_revision: 27f3fd2
tags: [backend, data]
---

# Matriz CRUD

Componente/caso de uso × entidad. C=Create, R=Read, U=Update, D=Delete (borrado lógico salvo nota).
Owner = módulo/servicio responsable de la escritura. La columna transacción indica si la operación es
multi-tabla atómica (ver [[transactions]]). Estado **INFERIDO**: derivado de módulos y del esquema; no
se auditó cada servicio línea a línea.

| Componente / caso de uso | Owner | user | membership | plan | entitlement | credential | decision | outbox | notification | routine | session | Transacción |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Registro / login | `auth` | C R U | | | | | | | | | | No |
| Gestión de perfil de usuario | `users`/`profiles` | R U | | | | | | | | | | No |
| Alta de membresía | `membership` | R | C | R | C | | | C | | | | Sí (memb+hist+evento+outbox) |
| Cambio de estado de membresía | `membership` | | U | | U | | | C | | | | Sí (memb+status_history+evento) |
| Renovación/extensión (intent→confirm) | `membership` | R | U | R | C U | | | C | | | | Sí (intent+extension+memb) |
| Catálogo de planes/features | `membership` (admin) | | | C R U D | | | | | | | | No |
| Enrolar credencial de acceso | `access-control` | R | | | | C | | C | | | | Sí (cred+evento) |
| Revocar credencial | `access-control` | | | | | U | | C | | | | No |
| Ingesta de evento de dispositivo | `access-control` | R | R | | R | R | C | C | | | | Sí (evento→decisión) |
| Resolver decisión (worker) | worker access-event | | R | | | R | C U | U | C | | | Sí |
| Escaneo de expiración | worker membership-reminder | R | R | R | | | | C | C | | | Sí (dedup notif) |
| Entrega de notificación | worker notification-delivery | | | | | | | U | U | | | Sí (msg+attempt) |
| Preferencias de notificación | `notifications` | R | | | | | | | | | | No |
| Crear/editar rutina | `training` | R | | | | | | | | C R U D | | No |
| Asignar rutina a cliente | `training` | R | | | | | | C | | R | | Sí (asignación+evento) |
| Iniciar/registrar sesión | `workouts` | R | | | | | | | | R | C R U | No (UK activa protege) |
| Registrar serie | `workouts` | | | | | | | | | | R U | No |
| Sync dataset de ejercicios | worker exercises-dataset-refresh | | | | | | | | | | | Sí (upsert idempotente) |
| Import legacy | `integration` | R U | C U | | | | | C | | | | Sí (por lote/record) |

## Notas de propiedad y autorización

- **Autorización en el servicio** (regla 10-backend-architecture): la propiedad por recurso se valida
  en la capa service; acceso a recurso ajeno responde **404, no 403**.
- **Escritura de outbox/eventos**: cualquier caso de uso que cambie estado de negocio relevante emite
  un `domain_event` + `outbox_job` en la **misma** transacción (ver [[transactions]]).
- **Historiales append-only** (`domain_events`, `status_history`): solo C y R; U/D bloqueados por
  trigger a nivel de base.
- **"D" en catálogos** (planes/features/rutinas) suele ser **borrado lógico** (status INACTIVE/ARCHIVED),
  no `DELETE` físico; las FKs RESTRICT hacia `usuarios`/planes impiden borrados con historial.

## Referencias

- [[transactions]] · [[relationship-catalog]] · [[state-and-lifecycle-models]]
