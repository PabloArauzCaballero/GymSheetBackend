---
title: "Límites de módulo y dependencias permitidas"
type: architecture
status: verified
last_reviewed: "2026-08-06"
source_revision: "27f3fd2"
tags: [backend, architecture]
---

# Límites de módulo y dependencias permitidas

Dependencias reales entre módulos de dominio (verificado leyendo cada `*.module.ts`). Diagrama en
[[02-architecture/dependency-map]].

## Regla

Un módulo solo usa a otro **importándolo** y consumiendo los providers que este **exporta**. No hay
acceso cruzado a repositorios no exportados. Se excluyen de la tabla `SequelizeModule.forFeature` y
`PassportModule` (infraestructura).

## Matriz de dependencias (importa →)

| Módulo | Importa | Exporta (principales) |
|---|---|---|
| `auth` | `users` | — |
| `users` | — (hoja) | UsersRepository, UsersService |
| `profiles` | — (hoja) | ProfilesService |
| `equipment` | — (hoja) | EquipmentRepository, EquipmentService |
| `exercises` | `equipment` | ExercisesService, ExercisesRepository, ExerciseMediaRepository, ExercisesDatasetService |
| `workouts` | `exercises` | WorkoutsService, WorkoutsRepository |
| `training` | `exercises`, `workouts` | TrainingService, TrainingRepository |
| `export` | `users`, `profiles`, `workouts`, `equipment` | — |
| `facilities` | `equipment`, `integration` | FacilitiesRepository, FacilitiesService |
| `access-credential` | `users` | AccessCredentialRepository, AccessCredentialService |
| `access-control` | `membership`, `access-credential`, `integration` | AccessControlRepository, AccessControlService |
| `notifications` | `integration` | NotificationService, MembershipReminderService, NotificationDeliveryService |
| `membership` | `access-credential`, `facilities`, `integration`, `notifications`, `users` | MembershipRepository, MembershipService, BusinessDateService |
| `health` | `integration` | HttpMetricsService |
| `integration` | — (hoja) | Outbox*/DomainEvent* |

## Observaciones

- **Grafo acíclico.** No existe `forwardRef()` en todo `src` — no hay ciclos de dependencia entre
  módulos. Proveedores hoja: `integration`, `users`, `equipment`, `profiles`.
- **Hub principal: `integration`** — importado por 5 módulos (access-control, facilities,
  notifications, membership, health). Es el núcleo del outbox/domain-events.
- **Hubs secundarios:** `users` (4 dependientes), `equipment` (3).
- **`membership` es el agregador más acoplado** (importa 5 módulos): coordina el alta de socio que en
  una transacción crea usuario, credencial, preferencias y evento de dominio.
- `notifications` habla con el gateway externo por su propio `HttpGatewayNotificationAdapter`, **no**
  importando `GatewayModule` (que solo expone endpoints operativos y se registra en `AppModule`).

Ver [[02-architecture/architecture-risks]] (acoplamiento de `membership`, SPOF de `integration`).
