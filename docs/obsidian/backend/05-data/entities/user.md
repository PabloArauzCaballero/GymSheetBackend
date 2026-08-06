---
type: data
status: verified
last_reviewed: 2026-08-06
source_revision: 27f3fd2
tags: [backend, data]
---

# Entidad: user

## Identidad
- **Tabla:** `public.usuarios` · **Modelo:** `src/modules/users/user.model.ts` (`UserModel`)
- **PK:** `id` uuid v4 · **Clave natural:** `email` (UNIQUE)

## Definición de negocio
Persona registrada en GymSheet. Hub central del sistema: puede ser cliente, staff (coach, front-desk,
administración) y/o entrenador externo. Casi todas las relaciones parten de aquí y la autorización se
re-valida contra esta fila en cada request.

## Clasificación
Agregado raíz · Dominio identidad · Sensibilidad: **PII + credencial** (email, nombre, hash de
contraseña). Ver [[../sensitive-data]].

## Representaciones
- ORM: `UserModel` (props en inglés, columnas en español vía `field`).
- API: nunca se devuelve el modelo directo; se usa mapper (sin `password_hash`).

## Atributos
| Campo físico | Tipo | Req | Default | Restricción |
|---|---|---|---|---|
| id | uuid | Sí | uuid_v4 | PK |
| email | varchar(180) | Sí | — | UNIQUE |
| password_hash | varchar(255) | Sí | — | bcrypt |
| nombre_completo | varchar(180) | Sí | — | — |
| rol | varchar(30) | Sí | CLIENTE | CHECK: ADMIN, CLIENTE, ENTRENADOR_EXTERNO, COACH, FRONT_DESK |
| estado | varchar(20) | Sí | ACTIVO | CHECK: ACTIVO, INACTIVO |
| fecha_registro | timestamptz | Sí | now() | — |

## Invariantes
- Email único y en minúsculas (normalización en app).
- El hash de contraseña nunca sale del backend.
- Rol y estado restringidos por CHECK (no ENUM nativo).

## Relaciones
- 1:1 → anthropometric-profile, onboarding, customer-profile, staff-profile, notification-preference.
- 1:N → membership, entitlement, access-credential, notification, membership-intent, routine,
  routine-assignment (cliente y coach), workout-session, body-measurement.
- Referenciado con **RESTRICT** desde memberships, credentials, notifications, decisions,
  staff/customer profiles (protege trazabilidad; no cascada). Ver [[../relationship-catalog]] R01–R72.

## Estados
`estado`: ACTIVO ↔ INACTIVO (INFERIDO transición). Un usuario INACTIVO puede provocar `USER_INACTIVE`
en decisiones de acceso.

## CRUD
- C: registro (`auth`). R: perfil/listados. U: perfil, rol, estado (admin). D: borrado lógico
  (`estado=INACTIVO`); borrado físico impedido por FKs RESTRICT si hay historial.

## Eventos
Cambios relevantes de estado/rol emiten `domain_event` + `outbox_job` (INFERIDO por patrón; ver
[[../transactions]]).

## Sensibilidad
PII directa (email, nombre) y credencial (hash). No registrar en logs. Ver [[../sensitive-data]].

## Índices
- UK `email` + `idx_usuarios_email`.

## Riesgos
- **DATA:** relajar RESTRICT a CASCADE borraría historial de auditoría (no hacer).
- Contradicción modelo/físico: `role`/`status` declarados `DataType.ENUM` pero físicamente
  varchar+CHECK (cosmético; el esquema lo fija la migración). Ver [[../physical-data-model]].

## Evidencia
`schema.sql` L13–44; migración `202607190001` (amplía CHECK de rol); `user.model.ts`;
`src/common/enums/domain.enums.ts` (UserRole, UserStatus).

## Relaciones (wikilinks)
[[../entity-catalog]] · [[../data-dictionary]] · [[entities/membership|membership]] ·
[[03-domains/users/index|Dominio Usuarios]] · [[03-domains/auth/index|Auth]]
