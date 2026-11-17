# ADR-0019 — REPP opera la plataforma; el gimnasio deja de tener personal (franja 7a)

Estado: **aceptado**
Fecha: 2026-11-16
Continúa [ADR-0018](./ADR-0018-moderacion-central-de-repp.md) (moderación central de REPP).

## Contexto

Hasta ahora el gimnasio tenía personal con poder: `ADMIN` y `FRONT_DESK` operaban membresías, sedes,
control de acceso, soporte, permisos y auditoría; `ADMIN` además progresión, difusión de avisos,
medios, equipos, el catálogo global y las rutinas oficiales; `COACH`/`ADMIN` asignaban rutinas; un
`ADMIN` veía y editaba las rutinas privadas de su gimnasio, cobraba y respondía reseñas del
directorio de cualquier ficha de su gimnasio, y cada socio tenía un chat fijo con «el admin de su
gimnasio» (`TENANT_ADMIN`). `RolesGuard` dejaba que `SYSTEM_ADMIN` cumpliera cualquier
`@Roles(ADMIN)`.

El 2026-11-16 el dueño decidió: **REPP (la plataforma) opera y modera todo; el gimnasio no tiene
usuarios de personal.** El gimnasio será una cuenta de negocio que sólo gestiona afiliaciones; las
membresías que hoy opera el gimnasio pasan al marketplace, y el control de acceso físico y el canje
en recepción salen del producto. Eso se hace por franjas; esta es la primera.

## Decisión (franja 7a): quitar todo el poder, sin quitar todavía los valores

1. **`admin/*` es de REPP.** Cada controlador `admin/*` declara explícitamente
   `@Roles(UserRole.SYSTEM_ADMIN)`, salvo las superficies de moderación de ADR-0018 (`MODERATOR` +
   `SYSTEM_ADMIN`, sin cambios). Para actuar sobre un gimnasio concreto, `SYSTEM_ADMIN` lo suplanta
   con `POST /auth/impersonate-tenant` (que ya existía). Un `ADMIN`/`FRONT_DESK`/`COACH`/
   `ENTRENADOR_EXTERNO` heredado recibe `403` en todo `admin/*`, con o sin concesiones del catálogo
   de permisos. `src/common/guards/roles.guard.admin-routes.spec.ts` recorre todos los controladores
   `admin/*` y falla si una ruta declara otro rol, de modo que la próxima ruta queda cubierta sin
   enumerarla.
2. **Excepción: `admin/directory`.** No lleva rol porque el dueño de una ficha puede ser cualquier
   socio. Lo gestiona el dueño o `SYSTEM_ADMIN`; se quita la rama «`ADMIN` del gimnasio de la
   ficha», y cualquier otro recibe `404` (acceso horizontal). Que REPP no toque dinero se resuelve
   en la franja 8d. Responder o borrar la respuesta de una reseña: dueño o `SYSTEM_ADMIN` (`403` al
   resto, la reseña es pública).
3. **Asignación de rutinas por coach: se elimina.** `POST /routines/:id/assign` y
   `GET /routines/assignments/coach` dejan de existir (`404`). Las asignaciones existentes siguen
   visibles para el socio en `GET /routines/assignments/me` y siguen abriendo la rutina asignada.
4. **Política de rutinas.** Ver y editar una rutina privada ajena: sólo el autor y `SYSTEM_ADMIN`
   (las oficiales, sólo `SYSTEM_ADMIN`). Se elimina la rama del `ADMIN` del gimnasio del autor.
   El moderador central no lee la rutina por esta política: la lee en el expediente del caso
   (`content`, con su alcance en recuentos; [ADR-0018](./ADR-0018-moderacion-central-de-repp.md) §9).
5. **Catálogo global.** Gestionar medios de un ejercicio global exige `SYSTEM_ADMIN`, también en el
   worker `exercise-media-command`, que usa la cuenta de `SEED_ADMIN_EMAIL` con alcance nulo.
6. **Chat de sistema `TENANT_ADMIN`: se elimina.** No se crea ni se lista (el listado lo excluye
   aunque exista una fila abierta). La migración reversible `202611200301-revoke-tenant-admin-chats`
   revoca (`revoked_at`) los existentes y anota cuáles en `chat.tenant_admin_chat_revocations`, para
   que el rollback reabra exactamente esos. El CHECK `ck_chat_conversations_system_kind` queda
   intacto hasta 7d. Queda `CORPORATE` (soporte de REPP).
7. **Siembras.** `SEED_ADMIN_*` crea el `SYSTEM_ADMIN` de la plataforma (una base ya sembrada con ese
   correo como `ADMIN` pasa a `SYSTEM_ADMIN` al volver a sembrar: es la cuenta de quien opera la
   instalación). Ninguna siembra crea `ADMIN` ni `COACH`; la demo de entrenador es `CLIENTE`.
8. **Lo que se mantiene hasta 7d.** Los valores `ADMIN`, `FRONT_DESK`, `COACH` y
   `ENTRENADOR_EXTERNO` del enum y del CHECK de `usuarios.rol`, las tablas de personal
   (`membership.staff_profiles`) y sus rutas (`admin/membership/staff*`, ahora de `SYSTEM_ADMIN`), el
   catálogo de permisos (`admin.permissions`, que para `SYSTEM_ADMIN` no filtra nada), el atajo de
   `RolesGuard` (`SYSTEM_ADMIN` cumple `@Roles(ADMIN)`; ya ninguna ruta lo declara) y el cierre de
   cuentas de personal `POST /admin/users/:id/close`, que pasa a usar `SYSTEM_ADMIN` con las mismas
   reglas (incluida la de no cerrar el último `ADMIN` activo de un gimnasio, que 7d retira con el
   rol).

## Franjas siguientes

- **7b — afiliación.** El gimnasio como cuenta de negocio que gestiona sólo las afiliaciones de sus
  socios; modelo y rutas propios, fuera de `admin/*`.
- **7c — cuentas de negocio.** Alta, verificación y sesión de la cuenta de negocio del gimnasio (no
  es un `usuario` con rol de personal); sus membresías pasan al marketplace.
- **7d — contracción.** Se quitan los valores de personal del enum y del CHECK de `usuarios.rol`,
  las tablas y rutas de personal, el catálogo de permisos de gimnasio, el atajo de `RolesGuard`, la
  regla del último `ADMIN`, las filas `TENANT_ADMIN` con su valor en el CHECK de `system_kind` y el
  libro `chat.tenant_admin_chat_revocations`, y el control de acceso físico y el canje en recepción.
  Cada paso destructivo con su migración expand/contract y su rollback documentado.

## Consecuencias

- El personal heredado conserva su cuenta como persona (rutas de socio), sin ninguna superficie de
  administración. El frontend lo envía al portal de persona.
- Operar un gimnasio exige suplantarlo; la suplantación ya queda registrada
  (`auth.tenant_impersonated`) y la auditoría administrativa guarda `tenant_scope`.
- Rollback del código: volver a desplegar la versión anterior devuelve los roles a las rutas; la
  migración se deshace con `yarn migration:down` (reabre sólo los chats que ella revocó).
