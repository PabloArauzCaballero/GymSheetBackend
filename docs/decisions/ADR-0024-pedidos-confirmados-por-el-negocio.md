# ADR-0024 — Pedidos pagados por QR o en efectivo y confirmados por el negocio (franja 8d)

Estado: **aceptado**
Fecha: 2026-11-17
Continúa [ADR-0022](./ADR-0022-publicaciones-y-post-moderacion.md) (publicaciones, «qué es público»),
[ADR-0021](./ADR-0021-kyc-de-negocios-y-aprobacion-automatica.md) (`KycCipher`, máquina del KYC) y
[ADR-0020](./ADR-0020-cuentas-de-negocio-y-tipo-de-cuenta.md) (cuentas de negocio). Aplica
[ADR-0018](./ADR-0018-moderacion-central-de-repp.md) (expediente, §8) y
[ADR-0017](./ADR-0017-borrado-real-del-contenido-de-las-personas.md) (borrado real de archivos).

## Contexto

Decisiones del dueño: la persona paga con el **QR del negocio** (o en efectivo, método `CASH`); **el
negocio confirma**; REPP **nunca toca el dinero ni confirma**; los productos se coordinan por chat; precios
en BOB; una disputa es una denuncia `PAYMENT_ORDER` para REPP, que puede sancionar al negocio pero no
reembolsa.

Hasta 8c, `directory.payment_orders` tenía un comprobante como URL libre que mandaba el cliente (D6), la
configuración de cobro era pública (D5), confirmaba quien pasara `canManageEntity` —incluido
`SYSTEM_ADMIN` (D9)— por la consola `admin/directory/*`, no había cantidad ni stock reservado, ni
vencimiento, ni historial.

## Decisión

1. **Una orden es una fila de `directory.payment_orders`** (migración reversible
   `202611200801-business-orders`). Gana `quantity` (solo un producto lleva más de una unidad),
   `unit_amount` (CHECK `amount = unit_amount × quantity`), `method QR|CASH`, `expires_at`,
   `cancelled_at`/`cancel_reason BUYER|BUSINESS_UNAVAILABLE|EXPIRED`, el comprobante privado
   (`receipt_private_key`, `receipt_mime`, `receipt_sha256` del claro), `receipt_attempts`,
   `stock_reserved_units`, `rejection_code`, `decided_by_user_id`/`decided_at` (rellenados desde
   `verified_*`) y `reminders_sent`; `EXPIRED` entra al CHECK de estados. `receipt_url` y `verified_*`
   quedan para filas viejas y se contraen en 8f. Cada cambio de estado deja una fila en
   **`directory.payment_order_history`** (append-only, actor nulo = sistema): es la línea de tiempo.
2. **Máquina de estados.** QR: `PENDING_PAYMENT` → (comprobante) `PENDING_VERIFICATION` → `CONFIRMED`
   o `REJECTED` (motivo `AMOUNT_MISMATCH|UNREADABLE|NOT_RECEIVED|OTHER`, `OTHER` con nota), y desde
   `REJECTED` otro comprobante (máximo `ORDER_RECEIPT_MAX_ATTEMPTS` = 3 en total). CASH: nace en
   `PENDING_VERIFICATION` sin comprobante y el negocio confirma al cobrar. La persona cancela lo impago
   (`PENDING_PAYMENT`, `REJECTED`, efectivo pendiente); un QR ya pagado no lo cancela ella. Todo cambio
   pasa por `OrderLifecycle` bajo el candado de fila de la orden: dos confirmaciones a la vez dan una
   `200` y una `409 ORDER_INVALID_TRANSITION`, igual que repetir una confirmación.
3. **Quién decide.** Solo la cuenta `NEGOCIO` dueña de la ficha, en `business/me/orders*`; toda consulta
   va acotada a su `entity_id`, así lo ajeno es `404`. Persona, `MODERATOR` y `SYSTEM_ADMIN` reciben
   `403 ACCOUNT_KIND_NOT_ALLOWED` (D9). Un negocio suspendido sigue decidiendo lo ya pagado (plan §2.7).
   Solo vende una ficha con cuenta de negocio (las fichas viejas sin cuenta ya no tienen quién confirme).
4. **El precio sale de la publicación.** El cuerpo de creación es estricto `{ listingId, quantity?, method?,
   note? }`: cualquier monto, moneda o `planId` es `400`. Se guardan el precio unitario, el total en
   centavos (sin coma flotante), la vigencia del historial de precios y una copia de lo ofrecido.
   Solo lo público (ADR-0022) se compra; si no, `404`.
5. **Stock.** Al crear, `stock_reserved += quantity` bajo `FOR UPDATE` de la publicación (`409
   ORDER_OUT_OF_STOCK {available}`); al cancelar, rechazar o vencer se devuelve exactamente lo que la orden
   retiene (`stock_reserved_units`, así una orden vieja que no reservó no descuadra nada); otro comprobante
   tras un rechazo reserva de nuevo; al confirmar se descuenta de `stock_quantity` y de `stock_reserved`.
   `stock_reserved <= stock_quantity` ya lo garantizaba `ck_entity_plan_stock` (8c). Contra el acaparamiento:
   un pedido abierto por persona y publicación (`409 ORDER_ALREADY_OPEN {orderId}`), a lo sumo
   `ORDER_OPEN_MAX_PER_PERSON` = 5 abiertos (`409 ORDER_OPEN_LIMIT`) y `ORDER_MAX_QUANTITY` = 20 unidades,
   contados bajo un candado consultivo por persona.
6. **Datos de cobro privados (D5).** `GET /public/directory/entities/:id/payment-config` desaparece. El
   negocio guarda banco y titular en `business/me/payment-config` y sube el QR por multipart; las
   instrucciones (`/directory/payments/orders/:id/payment-instructions`) y el QR (`…/payment-qr`) solo los
   recibe el comprador de una orden abierta o rechazada, y nunca de un negocio que dejó de ser público
   (`409 ORDER_BUSINESS_UNAVAILABLE`: «no pagues»). NIT, número de cuenta y URL del QR pasan a opcionales
   (el NIT vive en el KYC).
7. **Comprobante y QR son archivos privados cifrados (D6).** JPEG/PNG verificados por bytes, cifrados con
   `KycCipher` (AES-256-GCM, misma `KYC_ENCRYPTION_KEY`) con **otra derivación de clave**
   (`gymsheet:payment-evidence:v1`), en `orders/{orderId}/receipt/{uuid}.bin` y
   `business/{entityId}/payment/{uuid}.bin`. Quedan fuera del montaje estático, fuera de la política
   anónima de MinIO, en el recuento de referencias y en las claves borrables de ADR-0017; el reemplazado se
   borra por `media.release`. Se sirven descifrados solo por rutas autorizadas, `no-store` y `nosniff`. Sin
   la clave, `503 PAYMENT_EVIDENCE_UNAVAILABLE` (en producción la API no arranca sin ella).
8. **Plazos: `worker:orders-maintenance`** (nuevo, `flushLogs()`, `worker.shutdown_requested`, en
   `docker-compose.yml` y Coolify, siempre encendido). Cada pasada, orden por orden en su transacción y
   re-comprobando bajo el candado: lo impago de un negocio no público se cancela
   (`BUSINESS_UNAVAILABLE`, aviso «no hagas ningún pago»); lo impago vencido pasa a `EXPIRED`
   (`ORDER_PAYMENT_TTL_HOURS` = 24 para QR, `ORDER_CASH_TTL_HOURS` = 72 para efectivo) y libera su stock;
   un comprobante sin decidir recuerda al negocio a las 24 h y 48 h (una vez cada uno). Métricas
   `gym_sheet_orders_undecided`, `…_overdue` y `…_oldest_seconds` en `/health/metrics`.
9. **Avisos** (in-app, con clave de deduplicación por orden y evento): al negocio, pedido en efectivo,
   comprobante recibido y recordatorios; a la persona, confirmado, observado con motivo, vencido y «no
   pagues». Un aviso que falla no deshace el cambio de la orden.
10. **Disputa `PAYMENT_ORDER`.** «Tengo un problema con este pedido» es `POST /me/reports` con el id de la
    orden: solo su comprador y no mientras está `PENDING_PAYMENT` (antes no hubo dinero); el denunciado es
    la cuenta del negocio. El expediente trae la copia del pedido (montos, estados, línea de tiempo, huella
    SHA-256 y referencia del comprobante, coincidencia del titular, estado del vendedor), nunca la clave
    del archivo. El comprobante lo ve REPP **solo dentro del caso**:
    `GET /admin/moderation/cases/PAYMENT_ORDER/:orderId/receipt` exige que exista el caso y pasa la misma
    regla §8 del expediente, y deja su fila `moderation/payment-order-receipt-view` antes de enviar los
    bytes. El veredicto puede suspender al negocio por la máquina del KYC; la escalera de personas no
    aplica (`422`) y una orden nunca se «oculta». REPP no reembolsa.
11. **Coincidencia del titular.** Al guardar la configuración, similitud de trigramas de
    `repp_normalize(titular)` contra la razón social y el representante del intento de KYC aprobado:
    `≥ 0,6` → `PASS`; menos → `WARN` y una fila `kyc_checks PAYMENT_HOLDER_MATCH WARN {similarity}` en ese
    intento para la post-revisión de REPP; sin KYC aprobado → `UNKNOWN`. Nunca bloquea.
12. **Se retiran** `admin/directory/*` (configuración de cobro, planes, precio, historial, órdenes de la
    ficha, confirmar, rechazar) y el controlador viejo de órdenes. Las publicaciones se editan en
    `business/me/listings*` (ADR-0022). El puente `dir_{tenant}_{slug}` de membresías **se conserva** al
    confirmar una orden de una ficha GYM con tenant, hasta 8e.

## Consecuencias

- Contrato nuevo y cambiado en `docs/endpoints/endpoints.md` y `openapi.yaml`. El cliente actual (web y
  móvil) todavía llama a la configuración pública, crea órdenes con `{ planId }` y sube el comprobante como
  URL: esas tres llamadas dejan de funcionar hasta el front de 8d.
- Riesgos aceptados: una persona con varias cuentas puede retener stock hasta el vencimiento (topes por
  persona, no por instalación); solo se conserva el último comprobante de una orden (los anteriores se
  borran, su huella no); el efectivo lo declara la persona y lo confirma el negocio, sin prueba; el
  registro del pago en efectivo **por el negocio** (plan §3.1 `orders/cash`) espera a la afiliación de 8e,
  que identifica a la persona.
- Cierre y exportación: `payment_order_history` entra al catálogo de cierre (actor anonimizado) y a la
  exportación; la clave del comprobante no se exporta. El cierre del negocio llega en 8f.
- Rollback: `yarn migration:down` encola en `media.release` todos los comprobantes y QR privados, devuelve
  a sus publicaciones las unidades que retienen las órdenes abiertas, pasa `EXPIRED` a `CANCELLED`, copia
  la decisión a `verified_*`, rellena con vacío lo opcional antes de restaurar sus `NOT NULL`, restaura el
  CHECK de denuncias `NOT VALID` (las disputas quedan como historia) y borra historial y columnas. Un
  disparador completa `unit_amount` y el plazo de 24 h para un escritor anterior a la migración (la
  versión previa durante el despliegue). El down de 8a (`202611200401`) ya no borra una ficha de negocio
  que tiene pedidos: la deja `SUSPENDED` con su historia financiera.

## Continuación en 8f (cierre del negocio)

[ADR-0028](./ADR-0028-cierre-exportacion-y-retencion-del-negocio.md) abre `me/account/*` (salvo `PATCH`) y `me/export/*` al negocio y define su cierre, su exportación, la retención del KYC por entorno (con los 5 años de los registros), el borrado del KYC a pedido, la contracción de `payment_orders.receipt_url`, el tope de pedidos abiertos de un negocio no verificado y el fin de las afiliaciones cuando cierra un gimnasio o un coach (`BUSINESS_CLOSED`).
