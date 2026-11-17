# ADR-0029 — Contracción: sin roles, tablas ni rutas de personal del gimnasio (franja 7d)

Estado: **aceptado**
Fecha: 2026-11-17
Cierra lo que [ADR-0019](./ADR-0019-repp-opera-la-plataforma.md) (7a) dejó «hasta 7d». Sigue a
[ADR-0018](./ADR-0018-moderacion-central-de-repp.md) (`MODERATOR`), [ADR-0020](./ADR-0020-cuentas-de-negocio-y-tipo-de-cuenta.md)
y [ADR-0025](./ADR-0025-afiliaciones-a-la-ficha-del-gimnasio.md) (el gimnasio es una cuenta de negocio que solo gestiona
afiliaciones), [ADR-0026](./ADR-0026-suscripciones-unificadas.md) (maquinaria de membresías y control de acceso retirados)
y [ADR-0027](./ADR-0027-comunidad-del-gimnasio-por-afiliacion.md) (Conocer por la afiliación).

## Contexto

Decisión del dueño (16/11/2026): REPP (`SYSTEM_ADMIN` y `MODERATOR`) opera y modera todo; el gimnasio no tiene
usuarios de personal. 7a les quitó todo el poder a `ADMIN`, `FRONT_DESK`, `COACH` y `ENTRENADOR_EXTERNO`, pero dejó
los valores del enum y del CHECK, las tablas de personal, el atajo de `RolesGuard`, el catálogo de permisos, el
cierre de cuentas de personal y el valor `TENANT_ADMIN` del chat de sistema. 8e (ADR-0026) retiró sus rutas
(`admin/membership/*`, `admin/access/*`) y dejó las tablas `access_control.*` y `membership.staff_*` en su sitio porque
la clasificación de Conocer leía `access_control.decisions` y el cierre de personal leía `staff_profiles`.

## Inventario y decisión por elemento

| Elemento | Quién lo usaba al empezar 7d | Decisión |
|---|---|---|
| Valores `ADMIN`, `FRONT_DESK`, `COACH`, `ENTRENADOR_EXTERNO` de `UserRole` | Atajo de `RolesGuard`, regla del último `ADMIN` del cierre de personal, la siembra de la vitrina (pasaba un `COACH` a `CLIENTE`), pruebas | **Se quitan del código**. Ninguna ruta los declaraba desde 7a |
| CHECK `ck_usuarios_rol` | — | **Se acota** a `SYSTEM_ADMIN`, `MODERATOR`, `CLIENTE`, `NEGOCIO` (los cuatro en uso: verificado en código y siembras) |
| Cuentas con rol de personal | Ninguna ruta; inician sesión como persona desde 7a | **Pasan a `CLIENTE`** (migración 1). No se cierra ninguna: ver «Por qué no se cierran» |
| Atajo de `RolesGuard` (`SYSTEM_ADMIN` cumple `@Roles(ADMIN)`) | Ninguna ruta lo necesitaba | **Se quita**: un rol entra solo donde la ruta lo nombra |
| `POST /admin/users/:id/close` (cierre de personal) | Solo cuentas de personal (la web lo ofrece solo a filas `ADMIN`/`COACH`/`FRONT_DESK`/`ENTRENADOR_EXTERNO`) | **Se elimina** (`404`), con la regla del último `ADMIN` y los códigos `STAFF_CLOSURE_*`. La expersona de personal se cierra la cuenta con `DELETE /me/account` |
| Tablas `membership.staff_profiles`, `membership.staff_branch_scopes` | El catálogo de cierre | **A `retired`** (migración 2) con datos, índices y FK; el cierre las sigue anonimizando y la exportación las devuelve |
| `access_control.credentials`, `devices`, `device_events`, `decisions` | El cierre, la exportación y la señal «entrenando ahora» de Conocer | **A `retired`** (migración 2); el esquema `access_control` vacío se borra. La señal pasa a ser solo un entrenamiento en curso (ver abajo) |
| Catálogo de permisos: `admin.permissions`, `admin.user_permissions`, `admin.retired_permission_grants`, `PermissionGuard`, `@RequirePermission` | Tres rutas (`admin/support/*`, `admin/routines/:id/insights`, `admin/audit`) y `admin/permissions/*`; todas `@Roles(SYSTEM_ADMIN)`, y `SYSTEM_ADMIN` pasaba el guard por rol: **ninguna concesión abría nada** | **Se retira**: tablas a `retired`, guard, decorador, modelos, repositorio y siembra fuera. `catalog`, `GET/POST :userId` y `DELETE :userId/:key` → `404`. **Queda** `GET /admin/permissions/me` (solo `SYSTEM_ADMIN`), **obsoleto**, que devuelve todas las claves: la web lo usa al cargar la sesión del operador para mostrar botones, y quitarlo apagaría la consola de REPP |
| Chat de sistema `TENANT_ADMIN` y su libro `chat.tenant_admin_chat_revocations` | El listado lo excluía; nada lo creaba | **A `retired`** (migración 3): la conversación y todas sus filas hijas se copian y se borran de `chat`; el CHECK `ck_chat_conversations_system_kind` admite solo `CORPORATE`. Se quita el filtro del listado y el valor del tipo |
| Eventos `staff.profile-created.v1`, `staff.employment-status-changed.v1` y enums `EmploymentStatus`, `StaffPosition` | Nadie los emitía | **Se quitan** del catálogo de eventos |
| `UsersRepository.createStaffUser` | Nadie | **Se quita** |
| Siembras | `SEED_ADMIN_*` crea el `SYSTEM_ADMIN`; la vitrina convertía un `COACH` viejo | Sin roles de personal; se quita la conversión (la hace la migración) y la siembra del catálogo de permisos |
| `facilities.*` (sedes, salas, `access_points`), canje de premios en recepción (`admin/progression/prizes/redeem`), afinidad «misma sede» | Rutas vivas de `SYSTEM_ADMIN` y Conocer | **Fuera de 7d** (ADR-0027 los deja a 7e). `retired.access_control_devices` sigue apuntando a `facilities.access_points` |

### Conocer sin control de acceso

`training_now` era «sesión `EN_PROGRESO` en las últimas 3 h» **o** «entrada física `GRANTED` en las últimas 3 h». La
entrada física salió del producto (nadie escribe `decisions` desde 8e), así que la segunda rama era una señal
muerta. Queda la primera, que es real y la produce la propia app; nunca se muestra (solo ordena). El
peso `activity` no cambia. La prueba `social-discovery-ranking` comprueba que quien entrena ahora sube primero (falla si
se anula la señal) y que `access_control.decisions` ya no existe.

### Por qué no se cierran las cuentas de personal

Cerrar es borrar datos personales y no se puede deshacer; es un derecho de la persona, no una limpieza. Desde 7a
esas cuentas ya entran como persona (rutas de socio), pueden tener entrenamientos, perfil, chats y rutinas, y
ninguna regla las distingue de una cuenta de prueba de forma fiable. Convertirlas en `CLIENTE` conserva a la persona
y es reversible; quien no la quiera la cierra desde la app como cualquiera. Una cuenta de demostración se limpia por
la siembra o a mano, no por una migración.

## Migraciones (reversibles, idempotentes)

1. `202611201301-staff-roles-to-members`: crea el libro `retired.staff_role_conversions (user_id, previous_role,
   converted_at)`, anota cada cuenta con rol de personal, la pasa a `CLIENTE` y acota el CHECK. **Down**: ensancha el
   CHECK, devuelve su rol a las cuentas del libro que siguen siendo `CLIENTE` (una promovida a `MODERATOR` después
   queda como está) y borra el libro. Un segundo `up` no encuentra roles de personal y no toca el libro.
2. `202611201302-retire-staff-and-access-control`: mueve `access_control.{decisions, device_events, devices,
   credentials}`, `membership.{staff_branch_scopes, staff_profiles}` y `admin.{user_permissions, permissions,
   retired_permission_grants}` a `retired` con el esquema como prefijo (patrón de ADR-0026) y borra el esquema
   `access_control`. **Down**: lo recrea y devuelve cada tabla a su esquema y nombre. `admin.audit_log` se queda.
3. `202611201303-retire-tenant-admin-chats`: copia las conversaciones `TENANT_ADMIN` con participantes, mensajes,
   visibilidad, reacciones y eventos a `retired.chat_tenant_admin_*` (las copias cuelgan en cascada de la
   conversación copiada), mueve el libro de 7a a `retired` apuntando a la copia, borra las filas de `chat` y acota el
   CHECK a `CORPORATE`. **Down**: ensancha el CHECK, devuelve cada fila y el libro con su FK original, y borra las
   copias; así el down de `202611200301` puede reabrir exactamente sus chats.

Probadas up → down → up en e2e (`test/staff-contraction.e2e-spec.ts`, dentro de una transacción que se deshace,
con cuentas de los cuatro roles, un `MODERATOR` que no debe cambiar, perfiles de personal, credenciales y un chat
`TENANT_ADMIN` con mensaje, reacción y libro) y por la CLI (`yarn migration:up` / tres `migration:down` /
`migration:up` sobre una base con dos cuentas de personal, un perfil de personal y un chat `TENANT_ADMIN` con mensaje y libro: roles, chat, libro y tablas vuelven en el down y se retiran de nuevo en el up).

## Cierre y exportación

El catálogo de cierre apunta a `retired.membership_staff_profiles` (anonimiza y da de baja),
`retired.access_control_credentials` (revoca), `retired.access_control_decisions` (se conserva: registro del
gimnasio), `retired.admin_user_permissions` y `retired.admin_retired_permission_grants` (borra),
`retired.staff_role_conversions` (borra, interno: una cuenta cerrada no tiene rol que devolver) y el chat retirado
(`retired.chat_tenant_admin_messages` con sus archivos y luego la conversación copiada, en cascada; para cualquiera
de los dos lados, porque nadie puede leerlo; un mensaje denunciado se conserva como en el chat vivo). La exportación
suma la ficha de personal, las credenciales y entradas retiradas y los mensajes propios del chat retirado. El
inventario de FK a `usuarios` de `account-closure.e2e-spec.ts` ya no exime a la ficha de personal: ahora la cierra
una persona.

## Consecuencias

- Contrato: `docs/endpoints/endpoints.md` y `openapi.yaml` (`rol` ya no admite los roles de personal).
- Clientes que se rompen (web, solo lectura en esta franja): el botón «Cerrar cuenta» de personal
  (`staff-closure-*`) recibe `404` y nunca se ofrece (ninguna fila tiene esos roles); la página `/admin/permissions`
  (catálogo, concesiones) recibe `404`. Lista exacta en el informe de la franja.
- Rollback: `yarn migration:down` tres veces, en orden inverso, y volver a desplegar el código anterior.
- Riesgos aceptados: un mensaje de un chat `TENANT_ADMIN` citado por una denuncia queda en `retired` (la copia de
  evidencia de `moderation.chat_message_evidence` no cambia); las tablas de `retired` esperan su `DROP` (≥ 30 días,
  franja posterior); `GET /admin/permissions/me` sobrevive hasta que la web decida por rol.

## A confirmar con el dueño

1. ¿Se borra `GET /admin/permissions/me` cuando la web deje de usarlo, o REPP quiere un catálogo de permisos propio
   para su equipo (soporte, finanzas) más adelante? Hoy no hay ninguno.
2. ¿Alguna cuenta de personal conocida es de prueba y conviene cerrarla en producción? La migración no cierra nada.
