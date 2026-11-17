# ADR-0026 — Suscripciones = afiliación SOCIO confirmada + compra en el marketplace (franja 8e)

Estado: **aceptado**
Fecha: 2026-11-17
Continúa [ADR-0024](./ADR-0024-pedidos-confirmados-por-el-negocio.md) (pedidos confirmados por el negocio),
[ADR-0025](./ADR-0025-afiliaciones-a-la-ficha-del-gimnasio.md) (afiliaciones a la ficha GYM),
[ADR-0022](./ADR-0022-publicaciones-y-post-moderacion.md) (tipos de oferta, `validity_days = duration_days`,
`sessions_count`) y [ADR-0019](./ADR-0019-repp-opera-la-plataforma.md) (el gimnasio no tiene personal).

## Contexto

Decisiones del dueño: los gimnasios ya no operan membresías («las membresías pasan al marketplace»); el
control de acceso físico y el canje en recepción salen del producto; «unificar lo que existe en
suscripciones»; REPP nunca toca el dinero; el efectivo está permitido (pedido `CASH`, ADR-0024).

Hasta 8d había dos vías de alta: la del gimnasio (`membership.plans` global sin dueño, intenciones por
WhatsApp, enlaces de activación, extensión en el sitio que reactivaba incluso una cancelada, sin alcance de
tenant) y la del marketplace (pedido confirmado por el negocio, que creaba la membresía en un plan espejo
`dir_{tenant}_{slug}` solo para fichas con tenant).

## Decisión

1. **Un solo libro de periodos: `membership.memberships`** (se conserva con su historial, sus eventos y sus
   recordatorios). Migración reversible `202611201001-subscription-ledger` (8e-1, expand): `entity_id`
   (vendedor), `entity_plan_id` (publicación), `payment_order_id` (UNIQUE: un pedido = un periodo),
   `affiliation_id` (SOCIO, nula), `offer_kind`, `plan_name` (lo vendido, aunque la publicación cambie o
   se archive), `sessions_total`/`sessions_used`, `origin MARKETPLACE|LEGACY`; `plan_id` y `ends_on` pasan
   a opcionales. La base garantiza con FK compuestas que la publicación es del vendedor y que la
   afiliación es **de esa persona en ese gimnasio**, y con CHECK que un periodo MARKETPLACE tiene pedido,
   vendedor y publicación, que solo un pack o una sesión sin vigencia no tiene fin y que las sesiones
   usadas no superan las compradas.
2. **Relleno sin perder historia.** Una membresía creada por el puente de 8d (el pedido la apunta, o su
   metadata nombra el pedido) pasa a MARKETPLACE con el vendedor, la publicación y el tipo del pedido. El
   resto es LEGACY: `plan_name` de su plan, tipo `DAY_PASS` si el plan lo era y `MEMBERSHIP` si no, y
   `entity_id` la única ficha GYM con el `tenant_id` del titular, si hay exactamente una (informativo: una
   fila LEGACY **nunca** se muestra a un negocio, porque nadie verificó que ese negocio sea quien la cobró).
3. **Un pedido confirmado = un periodo nuevo, nunca una extensión en el sitio.** `starts_on = max(hoy, fin
   del último periodo ACTIVE de la misma publicación + 1)`, `ends_on = starts_on + vigencia - 1`; un pase
   de día dura un día; un pack o servicio sin vigencia no tiene fin; una sesión suelta cuenta una. La
   vigencia y las sesiones salen de la **copia del pedido** (lo que se pagó), no de la publicación editada
   después. Fechas en `BUSINESS_TIME_ZONE`.
4. **Membresía de gimnasio = afiliación SOCIO + periodo ACTIVE.** Al crear el pedido de un `MEMBERSHIP` de
   una ficha GYM: quien ya es SOCIO (confirmado o pendiente) de ese gimnasio compra tal cual; si no, el
   checkout trae `affiliation { locationId, ciLast3, switchGym? }` y la solicitud `REQUESTED` nace en la
   misma transacción que el pedido, con todas las reglas de ADR-0025 (correo verificado, sede del
   gimnasio, topes, esperas; SOCIO confirmado de otro gimnasio → `409 SOCIO_OF_ANOTHER_GYM {affiliationId,
   action: SWITCH_GYM}`, y con `switchGym` el cambio se hace cuando el nuevo gimnasio confirme). Sin esos
   datos: `422 AFFILIATION_REQUIRED`. Pases, packs y servicios de coach o centro no piden afiliación.
5. **Confirmar es una transacción.** Candado de la persona (el mismo de las afiliaciones) → candado de la
   fila del pedido → si es la membresía de un gimnasio y la persona tiene la SOCIO `REQUESTED` ahí y el
   negocio mantiene «también confirmo que es socio» (`alsoConfirmAffiliation`, por defecto `true`),
   `GymAffiliationsService.confirmInTransaction` → periodo, su fila de historial y el evento
   `subscription.period-opened.v1` → pedido `CONFIRMED` (apunta al periodo) → avisos. Si falla la
   afiliación (p. ej. `409 GYM_NOT_ACTIVE` de un gimnasio suspendido) o el periodo, nada cambia. Un aviso
   que falla no deshace nada (patrón de ADR-0024 §9). Se elimina el puente `dir_…`.
6. **Lo que ve la persona** (`GET /me/subscriptions`, `/:id`): agrupado por negocio y publicación, el periodo
   en curso y la renovación encadenada (`UPCOMING`), el estado mostrado (`ACTIVE`, `EXPIRING` a 7 días o
   menos, `EXPIRED`, `SUSPENDED`, `CANCELLED`, o `PENDING` si solo hay un pedido abierto), días restantes,
   sesiones, el pedido abierto, el destino de «Renovar» (la publicación, si sigue a la venta) y su SOCIO en
   ese gimnasio. El historial no dice quién hizo cada cambio.
7. **Lo que ve el negocio** (`GET /business/me/subscriptions?status`): el último periodo de cada (persona,
   publicación) que **él** vendió, con nombre visible, afiliación y sede, vencimiento y último pago; filtros
   «por vencer» (`EXPIRING`) y «vencidos» (`EXPIRED`); cursor por (fin, id). Reemplaza
   `admin/membership/insights/lapsed`. Puede **cancelar** (final), **pausar** y **reactivar** con motivo
   (`OTHER` exige nota), bajo candado de fila; cada cambio deja historial, evento y aviso a la persona. Otro
   negocio, un periodo LEGACY o uno inexistente: `404`. Persona, `MODERATOR` y `SYSTEM_ADMIN`: `403`.
8. **Recordatorios.** `worker:reminders` lee el libro: un periodo ACTIVE que termina en 7, 3, 1 o 0 días
   recibe un aviso que nombra el plan y el negocio, salvo que ya tenga una renovación encadenada.
9. **Se retira la maquinaria del gimnasio** (8e-3, migración reversible
   `202611201002-retire-membership-machinery`): `plans`, `features`, `plan_features`, `entitlements`,
   `plan_access_scopes`, `intents`, `extensions`, `customer_profiles` y `public.membership_activation_requests`
   pasan, con sus datos, índices y FK, al esquema `retired` (prefijo `membership_`); `plan_id` pasa a
   `retired_plan_id`. Rutas que desaparecen (`404`): `/membership/plans*`, `/me/membership*`,
   `/memberships/me`, `/me/accesses`, todo `/admin/membership/*` (planes, funcionalidades, alcances,
   clientes, membresías, personal, intenciones, activación, usuarios e `insights/*`) y el control de acceso
   físico (`/access/me`, `/access/credentials/me`, `/admin/access/*`). Se van `worker:access` (y su servicio
   en Compose y Coolify), las variables `WHATSAPP_MEMBERSHIP_PHONE`, `ACTIVATION_LINK_TTL_HOURS`,
   `PORTAL_PUBLIC_URL`, `ACCESS_POLICY_VERSION`, `ACCESS_MOCK_ENABLED` y el medio global
   `qr-pago-renovacion` (`PAYMENT_QR_MEDIA_CODE`). Las tablas `access_control.*` y
   `membership.staff_profiles`/`staff_branch_scopes` quedan donde están (las lee la clasificación de
   Conocer hasta 7c y el cierre de cuentas de personal hasta 7d); nadie escribe en ellas.
10. **Cierre y exportación.** El catálogo de cierre y la exportación apuntan a `retired.*`: los datos
    personales de las tablas retiradas se siguen borrando o anonimizando hasta su `DROP` (franja posterior,
    30 días como mínimo). Los periodos se conservan sin notas, como registro del negocio.

## Consecuencias

- Contrato en `docs/endpoints/endpoints.md` y `openapi.yaml`. El cliente actual (web y móvil) que llama a
  las rutas retiradas deja de funcionar hasta el front de 8e (lista en el informe de la franja); comprar la
  membresía de un gimnasio sin ser su SOCIO pide la sede y el CI (`422 AFFILIATION_REQUIRED`).
- Riesgos aceptados: `sessions_used` existe pero ninguna ruta lo consume todavía (no hay check-in en el
  producto); un periodo LEGACY sin gimnasio conocido aparece a su titular en un grupo sin vendedor; un
  gimnasio suspendido por REPP sigue viendo a sus suscriptores (como sus pedidos) pero no confirma una
  SOCIO pendiente (confirma solo el pago con `alsoConfirmAffiliation: false`); el sello «atleta verificado»
  de una reseña ya no considera las entradas físicas, solo los periodos.
- Rollback: `yarn migration:down` devuelve las tablas a su esquema y nombre y la columna a `plan_id`; luego,
  a cada periodo sin plan (vendido tras 8e) le da un plan espejo inactivo `dir8e_<publicación>` y a uno sin
  fin un fin a un año, guarda en `metadata.ledger` lo que las columnas viejas no pueden tener (tipo, nombre,
  sesiones, afiliación, gimnasio de una fila LEGACY, «sin fin») y quita columnas y restricciones. Un `up`
  nuevo lo restaura todo (el periodo vendido tras 8e conserva además la referencia al plan espejo en
  `retired_plan_id`, sin efecto en la lectura): probado up → down → up con filas LEGACY y MARKETPLACE (e2e
  `subscriptions-retirement` y base de desarrollo con la semilla `mock`).
