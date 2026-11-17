# ADR-0022 — Publicaciones del marketplace, sedes y post-moderación (franja 8c)

Estado: **aceptado**
Fecha: 2026-11-17
Continúa [ADR-0020](./ADR-0020-cuentas-de-negocio-y-tipo-de-cuenta.md) y
[ADR-0021](./ADR-0021-kyc-de-negocios-y-aprobacion-automatica.md). Aplica
[ADR-0018](./ADR-0018-moderacion-central-de-repp.md) (moderación central, §8 y §9) y
[ADR-0017](./ADR-0017-borrado-real-del-contenido-de-las-personas.md) (borrado real de medios).

## Contexto

Decisiones del dueño (16/11/2026): el marketplace es como Facebook Marketplace, simple y rápido; todo
vendedor publica todo (perfil, planes y pases, productos, servicios); los precios van en **BOB**; REPP
modera de forma central con **post-moderación** (la publicación sale en el acto si pasa las
comprobaciones automáticas y REPP puede ocultarla o suspender al negocio después); REPP nunca toca el
dinero (los pedidos son la franja 8d) y la entrega de productos se coordina por chat (8f).

Hasta 8b existían `directory.entity_plans` (planes con tipo legado `MEMBERSHIP_PLAN|PASS|SERVICE|PRODUCT`,
historial de precios append-only) y su consola `admin/directory/*`, sin estado de moderación, sin
paginación real y sin superficie para el negocio.

## Decisión

1. **Una publicación es una fila de `directory.entity_plans`** (migración reversible
   `202611200601-business-listings`). Gana `offer_kind`
   (`MEMBERSHIP|DAY_PASS|MULTI_DAY_PASS|CLASS_PACK|PRODUCT|SERVICE_SESSION|SERVICE_PACK`, rellenado desde
   `type`); `type` se conserva **derivado** y comprobado (`ck_entity_plan_type_of_kind`) para que el
   código anterior siga leyendo. Además `sessions_count`, `stock_quantity`/`stock_reserved` (solo
   productos; `reserved ≤ quantity`), `product_category_id` (solo productos) y el estado de moderación
   `moderation_status` `LIVE|HELD|HIDDEN|REJECTED`, `moderation_reason_code`, `auto_check_codes`,
   `published_at`, `moderated_by_user_id`, `moderated_at`. **La validez es la columna existente
   `duration_days`** (en la API `validityDays`): el plan proponía una `validity_days` nueva, que habría
   duplicado el mismo dato.
2. **Campos por tipo** (`shapeViolations`, `422 LISTING_SHAPE_INVALID {violations}`): membresía y pase
   de varios días con validez (≥ 2 días el segundo); paquetes con sesiones; producto sin validez; stock
   y categoría de producto solo en productos. La base lo vuelve a comprobar **sobre toda fila `LIVE`**
   (`ck_entity_plan_live_validity`, `ck_entity_plan_live_currency` = `BOB`, `ck_entity_plan_live_published`)
   y sobre toda fila las sesiones, el stock y la categoría. Se condicionan a `LIVE` porque el relleno
   encuentra filas viejas en USD o sin validez: esas quedan `HELD` con su código
   (`CURRENCY_NOT_BOB`, `VALIDITY_REQUIRED`, `VALIDITY_NOT_ALLOWED`), visibles para su dueño, y nunca
   públicas. Una fila nueva nace `HELD` por defecto (falla cerrada).
3. **Post-moderación.** Al crear, editar o cambiar el precio corren comprobaciones síncronas: banda de
   precio en BOB (`LISTING_PRICE_MIN_BOB`–`LISTING_PRICE_MAX_BOB`, 1–50 000 por defecto,
   `PRICE_OUT_OF_BAND`), desvío respecto del precio de referencia del tipo
   (`LISTING_PRICE_OUTLIER_FACTOR` = 5×, hacia arriba o abajo, `PRICE_OUTLIER`) y términos prohibidos de REPP
   (`business.banned_terms`, ámbito `LISTING|BOTH`, la misma regla de palabra completa del KYC,
   extraída a `common/sql/banned-terms.ts`). Todo pasa → `LIVE` en el acto; algo falla → `HELD` con los
   códigos. En una publicación `LIVE` solo se vuelve a comprobar lo que cambió (texto o precio), así
   una liberación de REPP no se deshace por editar la descripción; una `HELD` vuelve a correr todo, y
   así el negocio la corrige. `HIDDEN` y `REJECTED` son de REPP: ninguna edición del negocio los levanta.
   **Precio de referencia** (corrección de la revisión de seguridad de 0ab2073): es la mediana de las
   medianas de cada **otro** vendedor, una por negocio y sin contar al que se comprueba, y solo existe con
   `LISTING_PRICE_MEDIAN_MIN_SELLERS` = 5 vendedores **distintos**. Antes era la mediana de filas: un
   vendedor con muchas publicaciones la movía a su gusto (para pasar su precio o para retener el de
   otros). Los códigos de cada pasada de comprobaciones se guardan siempre.
   La moderación de imagen de las fotos de publicaciones no entra (el puerto de 8b sigue `Noop`).
4. **Qué es público** (una sola definición, `PUBLIC_LISTING_SQL`): `moderation_status = LIVE`,
   `status = ACTIVE` y la ficha del negocio `ACTIVE`. Un negocio suspendido, pausado, en borrador o
   cerrado se lleva todas sus publicaciones (D7). Cualquier otra cosa responde `404` en la búsqueda, el
   detalle, el perfil, las rutas viejas `/public/directory/plans*`, la creación de órdenes y
   `POST /me/reports` (no se confirma que exista una publicación no pública).
5. **Desviación: el negocio publica sin estar `ACTIVE`.** El plan ponía «el negocio está ACTIVE» como
   comprobación de publicación; el §4.1 del mismo plan pide poder preparar publicaciones mientras el
   KYC está en revisión. Se resuelve como visibilidad y no como error: un negocio en KYC crea
   publicaciones (`visibility: BUSINESS_NOT_PUBLIC`) que salen solas cuando el KYC lo aprueba. Uno
   suspendido o cerrado no escribe nada (`409 BUSINESS_ACCOUNT_LOCKED`), como su perfil. Tope: 500
   publicaciones sin archivar por negocio (`409 LISTING_LIMIT`), contado bajo el candado de la ficha.
6. **Rutas del negocio** `business/me/listings*`, `business/me/locations*` y `business/me/gallery*`, solo
   `NEGOCIO` (inventario de rutas de ADR-0020 actualizado); toda consulta va acotada a la ficha de la
   cuenta, así que lo ajeno es `404`. Esquemas estrictos: moneda, estado de moderación, `type` o stock
   reservado en el cuerpo son `400`. Estados del negocio sobre su publicación: pausar
   (`ACTIVE→INACTIVE`), reanudar y archivar (terminal, no se edita: `409 LISTING_NOT_EDITABLE`). Precio
   por el historial append-only existente. **Mientras REPP la tiene oculta o rechazada, el contenido
   queda congelado** (nombre, descripción, beneficios, validez, sesiones, categoría, precio y fotos
   nuevas: `409 LISTING_LOCKED_BY_REPP`); pausar, reanudar, archivar, stock y quitar una foto siguen
   abiertos. Así REPP libera o restaura exactamente lo que revisó; se eligió frente a «volver a
   comprobar al liberar» porque esa variante anulaba la liberación humana de un falso positivo (un
   precio legítimo fuera de banda volvería a `HELD`). Fotos (publicación ≤ 10, galería del perfil ≤ 10) solo por
   multipart, JPEG/PNG verificados por bytes, públicas bajo `business/{entityId}/public/` y borradas de
   verdad cuando ninguna fila las referencia (`entity_plans.media_urls` y `entities.gallery` entran en
   el recuento de ADR-0017).
7. **Sedes** `directory.entity_locations` (`name` único por negocio sin mayúsculas, ciudad, dirección,
   coordenadas en pareja y en rango, horario, orden, `legacy_branch_id` hacia `facilities.branches`;
   el relleno crea una por cada ficha que ya tenía `branch_id`). Máximo 50. Son públicas con el perfil.
8. **Marketplace público** `GET /public/directory/listings` (filtros de tipo, negocio, categoría
   —del producto o, si no tiene, la del vendedor—, ciudad, precio, verificados y texto o `@handle`),
   `GET /public/directory/listings/:id` y `GET /public/directory/profiles/:handle` (ficha, sedes y
   primera página; un handle renombrado devuelve `{ redirectTo }`). Paginación **por cursor real**
   (keyset sobre `(published_at, id)` o `(current_price, id)`, el instante con microsegundos en el
   cursor) e índices parciales sobre lo público: trigramas sobre `repp_normalize(name)`, recientes,
   precio, y `(offer_kind, moderation_status, current_price)` para la mediana. El texto se normaliza en
   la base con `repp_normalize`, que deja solo `[a-z0-9 ]`: no puede inyectar comodines. El mapper
   público no lleva estado de moderación, cifras de stock (solo `inStock`), metadatos, dueño ni
   gimnasio; la insignia es `VERIFIED` (REPP aprobó a mano) o `NEW` (aprobación automática).
   **Desviación:** no hay orden por relevancia; con cursor estable exigiría fijar una instantánea del
   ranking. Los filtros «cerca» y «abierto ahora» del plan son de `/public/directory/entities` y no
   entran aquí.
9. **Moderación** (ADR-0018). Tipos nuevos de denuncia `BUSINESS_LISTING` (id de la publicación) y
   `BUSINESS_PROFILE` (id de la ficha), entre gimnasios como los reels; el CHECK de
   `moderation.reports.target_kind` los admite, y el de `resolution`, `NEGOCIO_SUSPENDIDO`. Solo se
   denuncia lo público. El expediente trae la copia de la publicación o del perfil (§9, filas planas y
   mapper). Una publicación es ocultable: tres denunciantes distintos la ocultan a la espera de un
   moderador, el veredicto `hideContent` la pasa a `HIDDEN` y `false` restaura solo lo que estaba
   `HIDDEN`: a `LIVE` si sus códigos guardados están limpios y a `HELD` si no (estaba retenida cuando
   se ocultó). El veredicto gana `suspendBusiness`: suspende al negocio **dentro de la misma
   transacción** por la máquina de estados del KYC (`BusinessAdminService.suspendEntityFromCase`, el
   mismo camino que la consola: decisión, historial, ficha y cuenta `SUSPENDED`, aviso por la app y por
   correo; `409 BUSINESS_ACCOUNT_REQUIRED` si la ficha no tiene cuenta). La escalera de personas no se
   aplica a un negocio: `sanction` o `confirmMinor` en estos casos, o `suspendBusiness` en otro tipo, es
   `422 MODERATION_RESOLUTION_NOT_APPLICABLE`; denunciar no aparta a la persona del negocio en Conocer ni
   activa el flujo de menores. ADR-0018 §8 se extiende: un negocio dado de alta con el buzón canónico
   del moderador es su propio caso (`403 MODERATION_SELF_CASE`), en el expediente, al tomarlo y en el
   veredicto.
10. **Consola de publicaciones** `admin/business/listings` (`PLATFORM_MODERATION_ROLES`): cola `HELD`
    (o `HIDDEN`/`REJECTED`), más antigua primero; liberar (`LIVE`, solo si cumple la forma de su tipo y
    está en BOB: `409 LISTING_NOT_PUBLISHABLE`) o rechazar con motivo
    (`PROHIBITED_PRODUCT|MISLEADING|PRICE_ABUSE|DUPLICATE|OTHER`); aviso al negocio en la app, auditoría
    `business/listing-release|listing-reject`, nunca sobre el propio negocio. Es una superficie que el
    plan no listaba para 8c, pero sin ella una publicación retenida no tenía salida.
11. **Consola vieja `admin/directory/plans*`** (siembras de REPP, se retira en 8d): solo acepta `BOB`, y
    lo que crea queda `LIVE` solo con la forma de su tipo (`legacyListingState`), sin las comprobaciones
    de precio ni de términos (es REPP quien la usa).

## Consecuencias

- Contrato nuevo: `business/me/listings*`, `business/me/locations*`, `business/me/gallery*`,
  `public/directory/listings*`, `public/directory/profiles/:handle`, `admin/business/listings*`
  (`docs/endpoints/endpoints.md`, `openapi.yaml`). Cambian: `/public/directory/plans*` y
  `POST /directory/payments/orders` también exigen `LIVE`; `admin/directory/plans*` rechaza una moneda
  distinta de `BOB`; `POST /me/reports` y el veredicto de moderación ganan tipos y `suspendBusiness`;
  `GET /business/me` suma `entity.gallery`.
- Riesgos aceptados: el precio de referencia sigue siendo una heurística (cinco vendedores coordinados
  la mueven); entre que REPP mira una publicación `HELD` y la libera, el negocio puede editarla (la
  consola libera lo vigente; una versión esperada en la liberación cerraría esa ventana); tres personas pueden ocultar a la espera de revisión la publicación de un competidor
  (reversible, como con el resto del contenido); los archivos de una publicación oculta siguen
  accesibles por su URL pública si alguien la guardó (igual que el logo; servirlos tras una puerta es
  otra decisión); una sede declarada por un coach individual publica la dirección que él escriba (la
  interfaz debe advertirlo).
- `docs/db/schema.sql` no recoge las tablas del directorio ni del negocio (se aplican por migración)
  y no se toca.
- Rollback: `yarn migration:down` pasa a `INACTIVE` toda publicación no `LIVE` (el código anterior no
  conoce la moderación y no debe publicar lo retenido, oculto o rechazado), borra las sedes y las
  columnas, restricciones e índices nuevos, y restaura los CHECK de denuncias `NOT VALID` (las
  denuncias sobre publicaciones quedan como historia). Volver a subir no devuelve esas publicaciones a
  `ACTIVE`.
