# ADR-0018 — Moderación central de REPP

Estado: **aceptado**
Fecha: 2026-11-16
Afecta a [ADR-0013](./ADR-0013-antibot-alta-de-cuentas.md) (consulta de altas),
[ADR-0014](./ADR-0014-privacidad-retencion-y-consentimientos.md) (quién modera) y
[ADR-0017](./ADR-0017-borrado-real-del-contenido-de-las-personas.md) (evidencia de moderación).

## Contexto

Hasta ahora moderaba el personal del gimnasio: la consola `admin/moderation` estaba abierta a
`ADMIN` y `FRONT_DESK` (con los permisos `moderation:read` / `moderation:act`), cada uno acotado a
su gimnasio; `GET /admin/signups` y `GET /admin/routines` pedían `moderation:read`. Con eso el
personal del gimnasio veía denuncias, quién denunció, la copia de los mensajes denunciados, y
decidía avisos, suspensiones, expulsiones, menores y el ocultado de contenido.

El 2026-11-16 el responsable de producto decidió: **la moderación social la hace un equipo central
de REPP, no el personal del gimnasio.** Los textos legales dirán que modera REPP (tercera revisión
legal, hallazgo N1). El responsable también adelantó que REPP revisará toda la gestión y que el
gimnasio pasará a ser una cuenta de organización sin usuarios de personal; ese modelo se diseña
aparte.

## Decisión

### 1. Un rol de plataforma: `UserRole.MODERATOR`

`MODERATOR` (valor `MODERATOR` en `usuarios.rol`) es un rol de plataforma, como `SYSTEM_ADMIN`, y
no un rol de gimnasio:

- no satisface ninguna ruta de `ADMIN`, `FRONT_DESK` ni `COACH` (`RolesGuard` sólo lo admite donde
  se nombra), y no necesita concesiones del catálogo de permisos;
- en las superficies de moderación actúa sobre **todos los gimnasios**. Su `tenantScope` en el
  principal sigue siendo su propio gimnasio (es una cuenta de socio en todo lo demás, y las rutas de
  socio y de catálogo leen ese campo); las superficies de plataforma lo traducen con
  `platformScopeOf(actor)` (`src/common/tenancy/tenant-scope.ts`), que devuelve `null` para un
  moderador. Se eligió así y no dar `tenantScope: null` en el JWT porque `null` significa «sin
  filtro» en todo `admin/*` y en el catálogo (`resolveCatalogTenant`): dárselo al rol en el principal
  lo habría convertido en super-administrador de cualquier ruta abierta a todo usuario autenticado;
- `SYSTEM_ADMIN` también modera (todos los gimnasios, o sólo el suplantado). Se mantiene porque ya
  operaba la cola central y es quien crea moderadores; el equipo del día a día es `MODERATOR`.

El rol no depende de que el gimnasio tenga personal: nace de una cuenta de socio y lo asigna la
plataforma. Cuando el gimnasio pase a ser una cuenta de organización, el rol no cambia.

### 2. Alta y baja de moderadores: sólo `SYSTEM_ADMIN`, por API auditada

Hoy `SYSTEM_ADMIN` nace de la siembra (`SEED_SYSTEM_ADMIN_*`), que da una sola cuenta. Un equipo
necesita altas y bajas frecuentes, así que se sigue la otra vía que ya usa la plataforma —rutas
`SYSTEM_ADMIN` auditadas, como `admin/tenants`— en vez de sumar variables de siembra:

- `PUT /admin/platform/moderators/:userId`: una cuenta de socio activa (`CLIENTE`) pasa a
  `MODERATOR`; idempotente. Personal de gimnasio o `SYSTEM_ADMIN`: `409 MODERATOR_NOT_ASSIGNABLE`
  (una cuenta no lleva dos sombreros); inexistente o cerrada: `404`.
- `DELETE /admin/platform/moderators/:userId`: vuelve a `CLIENTE` y sus casos tomados vuelven a la
  cola; `404` si no era moderador.
- `GET /admin/platform/moderators`: la lista.

El rol se lee de la base en cada petición, así que ambos cambios valen en la siguiente llamada de la
cuenta. Un gimnasio no puede cerrar la cuenta de un moderador (`POST /admin/users/:id/close`
responde `404`, como con `SYSTEM_ADMIN`); el moderador cierra su cuenta después de que se le quite
el rol.

### 3. Qué pasa a la plataforma y qué conserva el gimnasio

Pasa a `MODERATOR` / `SYSTEM_ADMIN` (`PLATFORM_MODERATION_ROLES`), con `403` para el personal del
gimnasio, tenga o no las concesiones viejas:

- toda la consola `admin/moderation`: cola, expediente, tomar, soltar, veredicto (ocultar o
  restaurar contenido, aviso, suspensión, expulsión, confirmar o descartar menor) e historial;
- `GET /admin/signups` (verificación de altas, ADR-0013);
- `GET /admin/routines`: es la consola REPP de rutinas (oficiales, ocultas, denuncias abiertas). Las
  rutinas oficiales ya eran sólo de `SYSTEM_ADMIN`.
- la revisión de la selfie de verificación (`GET /admin/verifications`,
  `GET /admin/verifications/:id/selfie`, `POST /admin/verifications/:id/decide`): una selfie es un
  dato biométrico y el gimnasio no la ve. La cola trae `tenantId` y `tenantName` por intento; el
  enlace firmado sigue atado al moderador que lo pidió.

El gimnasio conserva sus operaciones (membresías, acceso físico, sedes, equipamiento, programas,
soporte, su catálogo de ejercicios y de progresión, `GET /admin/routines/:id/insights` con
`analytics:read`). Ninguno de esos caminos decide sobre contenido social.

Los permisos `moderation:read` y `moderation:act` desaparecen del catálogo. La migración
`202611200101-platform-moderators` amplía el `CHECK` de `usuarios.rol`, copia las concesiones a
`admin.retired_permission_grants` antes de borrarlas (para que el rollback las devuelva tal cual) y
devuelve a la cola los casos tomados por cuentas que no son de plataforma. Rollback: restaura
permisos y concesiones, borra la copia, convierte todo `MODERATOR` en `CLIENTE` (degradar es la
dirección segura) y restaura el `CHECK`; los casos soltados no se vuelven a tomar.

### 4. Cola central

La cola mezcla todos los gimnasios. Cada fila trae `tenant_id` y `tenant_name`; el expediente y el
veredicto traen `tenantId`. Las denuncias siguen guardando el gimnasio del contenido
(`moderation.reports.tenant_id`), sin cambios de modelo.

### 5. Auditoría

Toda decisión queda en `admin.audit_log` con el id del moderador (`actor_user_id`) y su rol:
`moderation/claim`, `moderation/release` (por `@Audited`) y `moderation/resolve`, escrito por el
controlador después del commit con `metadata { caseKind, tenantId, resolution, sanction,
contentHidden, minorConfirmed, reportsClosed }`. Las filas de un moderador son filas de plataforma
(`tenant_scope` nulo): la bitácora de un gimnasio no muestra las decisiones de REPP. Altas y bajas
de moderadores: `moderation/moderator-assign` y `moderation/moderator-revoke`. La decisión sobre una selfie queda como
`verification/decide` (`target_kind photo_verification`) con `metadata { tenantId, decision, reason }`,
escrita por el controlador después del commit.

### 6. Avisos

Los avisos a las personas (aviso, suspensión, expulsión, contenido oculto o restaurado, menor) y el
«Revisamos tu reporte» nombran al «equipo de moderación de REPP» y nunca al gimnasio. Los avisos de la
verificación (aprobada, rechazada, vencida sin revisión, revocada) nombran al «equipo de REPP».

### 7. Fuera de alcance

- **Apelaciones**: no existen; no se diseñan aquí.
- **Gimnasio como cuenta de organización**: pendiente de diseño con el responsable de producto. Los
  roles de gimnasio (`ADMIN`, `FRONT_DESK`, `COACH`, `ENTRENADOR_EXTERNO`) y el catálogo de
  permisos de personal se revisarán entonces; este ADR no crea roles ni permisos de personal.
- Una cuenta de moderador sigue siendo una cuenta de socio en lo social (perfil, Conocer). Separar
  cuentas de servicio de cuentas personales queda para el modelo de organización.

## Consecuencias

- (+) Quién ve las denuncias, la evidencia y decide sanciones coincide con lo que dirán los textos.
- (+) Un permiso mal concedido en un gimnasio ya no abre la moderación: la puerta es el rol.
- (−) Los gimnasios pierden la cola y la consulta de altas; el portal del gimnasio tiene que quitar
  esas pantallas.
- (−) Cambia el contrato: `403` para `ADMIN`/`FRONT_DESK` en `admin/moderation/*`, `admin/signups`,
  `admin/verifications*` y `GET admin/routines`; el catálogo ya no lista `moderation:*`.
