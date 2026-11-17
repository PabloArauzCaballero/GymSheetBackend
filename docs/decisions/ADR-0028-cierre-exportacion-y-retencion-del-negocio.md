# ADR-0028 — Cierre, exportación y retención de la cuenta de negocio (franja 8f)

Estado: **aceptado**
Fecha: 2026-11-17
Continúa [ADR-0020](./ADR-0020-cuentas-de-negocio-y-tipo-de-cuenta.md) (cuentas de negocio),
[ADR-0021](./ADR-0021-kyc-de-negocios-y-aprobacion-automatica.md) (KYC y retención),
[ADR-0022](./ADR-0022-publicaciones-y-post-moderacion.md) (publicaciones),
[ADR-0023](./ADR-0023-chat-con-negocios.md) (chat), [ADR-0024](./ADR-0024-pedidos-confirmados-por-el-negocio.md)
(pedidos), [ADR-0025](./ADR-0025-afiliaciones-a-la-ficha-del-gimnasio.md) (afiliaciones) y
[ADR-0026](./ADR-0026-suscripciones-unificadas.md) (suscripciones). Aplica
[ADR-0015](./ADR-0015-derechos-de-cuenta-cierre-exportacion-y-correo.md) y
[ADR-0017](./ADR-0017-borrado-real-del-contenido-de-las-personas.md) a la cuenta de negocio.

## Contexto

Hasta 8e una cuenta de negocio no podía cerrarse ni exportar sus datos (`AccountKindGuard` los dejaba
fuera, ADR-0020 §4), el cierre de un gimnasio no decía qué pasaba con sus socios (7b lo dejó abierto),
la retención del KYC no tenía el plazo de 5 años de los registros y sus valores eran constantes en
código, `payment_orders.receipt_url` seguía viva sin lectores y un negocio recién aprobado en
automático podía acumular pedidos sin límite antes de la revisión de REPP (plan §6.1).

## Decisión

1. **Mismo flujo que una persona.** `GET /me/account/closure-preview`, `POST /me/account/closure-pin` y
   `DELETE /me/account` quedan abiertos al negocio (`me/account/*` y `me/export/*` entran en la lista de
   `AccountKindGuard`; `PATCH /me/account` no: el nombre comercial es material y cambia por el KYC).
   El catálogo es `BUSINESS_CLOSURE_STEPS` (`src/modules/business-closure/business-closure.catalog.ts`):
   los pasos del negocio y, del catálogo de personas, solo los de la cuenta (sesiones, avisos,
   consentimientos, chats con REPP, evidencia de moderación). El mismo predicado cuenta en la vista
   previa y actúa en el cierre; tres pasos (`effect`) los aplica `BusinessClosureService` fila a fila
   (stock, historial y aviso).
2. **Rechazo previo.** Mientras haya un pedido QR `PENDING_VERIFICATION` (el dinero pudo moverse) el
   cierre responde **`409 BUSINESS_HAS_PENDING_VERIFICATIONS {count, action}`** y la vista previa lo
   anticipa en `blockers`. El cierre toma la cuenta y la ficha, luego **todas las publicaciones** (la
   creación de un pedido toma su publicación antes de leer al vendedor) y luego los pedidos abiertos,
   todo `FOR UPDATE`: ningún pedido nuevo ni comprobante entra a mitad del cierre.
3. **Qué hace el cierre**, en una transacción:
   - ficha `CLOSED`, sin insignia, logo, portada, galería ni contacto (archivos por `media.release`);
     nombre, tipo, categoría, ciudad y sedes quedan (los citan pedidos, chats y afiliaciones);
   - `@handle` `ACTIVE` → `RETIRED` **sin redirección**, bloqueado 180 días (`RETIRED_LOCK_DAYS`); las
     redirecciones de handles anteriores se quitan; una reserva `PENDING` sin publicar se libera;
   - publicaciones `ARCHIVED` sin fotos; historial de precios conservado;
   - pedidos `PENDING_PAYMENT`, `REJECTED` (el comprador podría reenviar) y en efectivo sin cobrar
     → `CANCELLED` con `cancel_reason = BUSINESS_CLOSED` y aviso «no pagues»; los demás se conservan
     como comprobante del comprador, sin la cuenta del negocio como autor;
   - datos de cobro y QR privado borrados;
   - afiliaciones vivas del gimnasio (socios y coaches) o del coach que cierra (sus vínculos) →
     `ENDED` (las pendientes `CANCELLED`) con `reason_code = BUSINESS_CLOSED`, sin dígitos del CI y con
     aviso a cada persona o coach (al gimnasio, si cierra el coach). **Esto cierra lo que 7b dejó
     abierto para el cierre de un GYM**;
   - **suscripciones**: los periodos ya vencidos quedan como historial; los que siguen en curso o no
     empezaron (`ACTIVE`/`SUSPENDED` con fin ≥ hoy o sin fin) → `CANCELLED` con historial (motivo
     `BUSINESS_CLOSED`, evento `membership.status-changed.v1`) y aviso. REPP no devuelve dinero: el aviso
     lo dice;
   - chats `BUSINESS`: los mensajes del negocio **se conservan** (constancia, ADR-0023), la persona
     queda en solo lectura (`can_write = false`) y `GET /me/conversations` marca `businessClosed: true`
     («Negocio cerrado»); abrir otro con esa ficha es `404`. Los bloqueos del negocio se borran;
   - cuenta `CLOSED` con `closed_at`; la fila de usuario se anonimiza como la de una persona;
   - KYC: se borran los códigos de teléfono; el resto queda para la retención (punto 6).
4. **Sanciones.** Con una suspensión de REPP en curso (cuenta `SUSPENDED`), una suspensión por tiempo o
   faltas vigentes, `moderation.closed_account_sanctions` guarda además los HMAC de los NIT y CI de
   todas sus versiones (las huellas de ADR-0021) y `business_suspended`. Una suspensión de REPP vale 5
   años. Heredar por correo en un alta nueva **marca** el registro (`consumed_at`) en vez de borrarlo si
   lleva NIT o CI, así la comprobación `CLOSED_ACCOUNT_SANCTION` del KYC lo sigue viendo por correo,
   NIT o CI hasta que vence → `IN_REVIEW`.
5. **Exportación del negocio** (`POST /me/export`, mismo worker): las secciones de la cuenta más
   `business.*` (perfil, @handle y cambios, sedes, publicaciones, historial de precios, datos de cobro
   sin clave del QR, pedidos con `buyer_display_name`, historial de pedidos, afiliaciones con
   `subject_display_name`, suscripciones vendidas MARKETPLACE con `buyer_display_name`, historial del
   KYC). Nunca el id ni las notas del comprador, los dígitos del CI de un socio ni quién decidió cada
   cambio. `businessKyc` (lo arma `KycExportReader`): NIT en claro; para un `INDIVIDUAL` (coach, el
   dueño es la persona) CI y teléfono en claro y todos sus documentos descifrados en base64; para una
   `COMPANY` solo las máscaras del representante y sus imágenes de CI y selfie
   `withheld: REPRESENTATIVE_IDENTITY` (el CI de otra persona); `SEPREC` siempre.
6. **Retención del KYC** (paso KYC de `privacy-retention`, borrado por `media.release`), valores por
   entorno `KYC_RETENTION_*_DAYS`, **propuestos y pendientes del abogado (Q5)**:

   | Caso | Plazo | Variable |
   |---|---|---|
   | DRAFT abandonado | 30 días | `KYC_RETENTION_ABANDONED_DRAFT_DAYS` |
   | Intento REJECTED (documentos y datos cifrados) | 30 días tras la decisión | `KYC_RETENTION_REJECTED_DAYS` |
   | SELFIE de un intento decidido (aprobado incluido) | 30 días tras la decisión | `KYC_RETENTION_SELFIE_DAYS` |
   | Versión aprobada reemplazada | 30 días | `KYC_RETENTION_SUPERSEDED_DAYS` |
   | CI de un negocio aprobado | mientras esté activo + 180 días tras el cierre (documentos, cifrados, nombre, dirección y complemento del representante) | `KYC_RETENTION_CLOSED_ACCOUNT_DAYS` |
   | Códigos de teléfono sin verificar | 1 día | `KYC_RETENTION_PHONE_CODE_DAYS` |
   | Decisiones, checks, historial, huellas (sin imagen ni dato en claro) | 5 años tras el cierre; huellas revocadas, 5 años tras revocarse | `KYC_RETENTION_RECORDS_DAYS` (mín. 365) |

   A los 5 años se borran historial, decisiones, checks, filas de documentos, huellas e intentos; la
   cuenta queda (cuelgan de ella la ficha y los pedidos de los compradores) sin intento vigente.
7. **Borrado a pedido** (`POST /business/me/kyc/erase {password}`): permitido. Borra documentos (motivo
   `USER_REQUEST`), cifrados, nombre y dirección del representante; un intento aprobado pasa a
   `SUSPENDED` y uno en revisión a `REJECTED` con reenvío, con decisión e historial del sistema; la
   cuenta queda **`SUSPENDED` con `KYC_MISSING`** y la ficha deja de ser pública. REPP no puede
   reactivarla tal cual (`409 KYC_INVALID_TRANSITION {reason: KYC_MISSING}`): necesita un KYC nuevo.
8. **Contracción de `payment_orders.receipt_url`** (migración `202611201202`): sin lectores en el backend
   ni en el frontend; los valores de filas viejas pasan a `retired.payment_order_receipt_urls` y el down
   los devuelve. El `DROP` de esa tabla queda para una franja posterior.
9. **Tope para negocios no verificados** (plan §6.1, decisión del dueño): un negocio cuya ficha no es
   «Verificado por REPP» (`is_verified`, aprobación humana de ADR-0021; una aprobación automática es
   «Nuevo») tiene a lo sumo `ORDER_OPEN_MAX_UNVERIFIED_SELLER` (10) pedidos abiertos
   (`PENDING_PAYMENT` + `PENDING_VERIFICATION`). Más allá, `409 ORDER_SELLER_OPEN_LIMIT` con un mensaje
   para la persona. Se cuenta bajo un lock consultivo por vendedor; un negocio verificado no lo toma.
10. **Endurecimiento** (auditoría de esta fase, plan de auditoría F8F-*): un comprobante a un negocio
    que dejó de ser público (suspendido, pausado o cerrado) responde `409 ORDER_BUSINESS_UNAVAILABLE`;
    antes se aceptaba y el pedido volvía a `PENDING_VERIFICATION`, esquivando la cancelación.

Migración `202611201201-business-closure`: `BUSINESS_CLOSED` en los CHECK de motivos de pedidos y
afiliaciones; columnas `nit_hmacs`, `ci_hmacs`, `business_suspended`, `consumed_at` (índices GIN) en
`closed_account_sanctions`. Down: los motivos nuevos vuelven a `BUSINESS_UNAVAILABLE`/`ACCOUNT_CLOSED`,
se borran los registros que solo un negocio produjo y los consumidos.

`BUSINESS_SIGNUP_ENABLED` sigue en `false` hasta la firma del abogado.

## Consecuencias

- Contrato: `docs/endpoints/endpoints.md` y `openapi.yaml`. Nuevos códigos
  `BUSINESS_HAS_PENDING_VERIFICATIONS`, `ORDER_SELLER_OPEN_LIMIT`; `blockers` en la vista previa;
  `businessClosed` en la lista de chats; `businessKyc` y `business.*` en la exportación;
  `POST /business/me/kyc/erase`.
- Decisiones a confirmar con el dueño: el pedido en efectivo sin cobrar se cancela (no bloquea); los
  periodos en curso se cancelan (no se dejan correr); el tope por defecto es 10; los plazos de retención
  y la exportación de documentos de una COMPANY (abogado).
- Riesgo aceptado: un archivo de exportación de un negocio con documentos pesa varias decenas de MB
  (documentos de hasta 8 MB en base64) y vive 7 días en `auth.account_exports`.
