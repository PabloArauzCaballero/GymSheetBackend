# ADR-0021 — KYC de negocios y aprobación automática (franja 8b)

Estado: **aceptado**
Fecha: 2026-11-16
Continúa [ADR-0020](./ADR-0020-cuentas-de-negocio-y-tipo-de-cuenta.md). Aplica
[ADR-0018](./ADR-0018-moderacion-central-de-repp.md) (moderación central de REPP),
[ADR-0014](./ADR-0014-privacidad-retencion-y-consentimientos.md) (consentimiento separado y
retención), [ADR-0017](./ADR-0017-borrado-real-del-contenido-de-las-personas.md) (borrado real) y
[ADR-0005](./ADR-0005-messaging-transactional-outbox.md) (outbox).

## Contexto

Decisión del dueño (16/11/2026): todo negocio sube su KYC y se aprueba **en segundos** con
comprobaciones automáticas y revisión posterior de REPP; si falla una comprobación, va a la cola de
REPP. REPP modera con su equipo central (`MODERATOR` + `SYSTEM_ADMIN`). SLA de la cola de revisión:
**24 h hábiles**; de la revisión posterior: **72 h**. El código del teléfono va por **WhatsApp
Business API**. No hay integración con SIN, SEGIP ni SEPREC (plan §6.7): solo forma, sin dígito
verificador inventado.

## Decisión

1. **Tablas** (migración reversible `202611200501-business-kyc`, esquema `business`):
   `kyc_submissions` (un intento por versión; `purpose` `INITIAL|RESUBMISSION|MATERIAL_CHANGE`; a lo
   sumo uno abierto por cuenta, índice parcial), `kyc_documents`, `kyc_checks`, `kyc_decisions` y
   `kyc_status_history` (las tres últimas append-only), `phone_verifications`,
   `identity_fingerprints`, `blocklist`, `banned_terms`; `accounts.current_submission_id`;
   consentimiento `KYC_SELFIE`; índice de trigramas sobre `repp_normalize(name)` de fichas `ACTIVE`.
2. **Cifrado propio.** `KycCipher`: AES-256-GCM, mismo formato que `ChatMediaCipher` (`GSKY1` + IV
   + tag), dominio `gymsheet:kyc:v1`, clave **`KYC_ENCRYPTION_KEY`** obligatoria en producción (el
   arranque falla sin ella; `docker-compose.coolify.yml` la exige) y **sin respaldo** en secretos JWT:
   sin clave, el KYC responde `503 KYC_UNAVAILABLE`. NIT, CI y teléfono se guardan cifrados más su
   **HMAC con el pepper de privacidad** (`IP_HASH_SECRET`, prefijo por tipo `nit:`, `ci:`,
   `phone:`, `email:`; el de correo es exactamente `hashEmail`). El HMAC del CI es **solo del
   número**: con el complemento, añadirlo, cambiarlo o quitarlo esquivaba la lista negra y el
   duplicado; dos personas con el mismo número van, a lo sumo, a revisión (WARN). La lista negra
   de CI bloquea el número, se escriba con el complemento que sea. Solo una máscara (`•••••••059`) es
   legible sin la clave. Riesgo residual: perder la clave pierde los documentos.
3. **Documentos** privados en `business/{accountId}/kyc/{submissionId}/{uuid}.bin` (nombre por id
   aleatorio: el cifrado con IV aleatorio hace inútil el nombre por contenido). El prefijo entra en
   `isPrivateStoredMediaPath` (404 en el montaje estático, ahora `mountLocalMedia`), en
   `isDeletableContentKey` (ADR-0017) y en la política MinIO de borrado; queda fuera de la lectura
   anónima. **Legibilidad al subir** con `sharp`: tipo por bytes (JPEG/PNG; HEIC se rechaza porque
   el decodificador empaquetado no lo lee), ≤ 8 MB, lado corto ≥ 800 px, desviación de luminancia
   ≥ 18 y brillo medio 35–235 → `{readable, readabilityCodes}` al instante. Kinds: `CI_FRONT`,
   `CI_BACK`, `SELFIE`, `SEPREC` (opcional, solo empresa). **El logo de la empresa es el logo
   público de la ficha** (`POST /business/me/media`): es público por propósito y no se guarda dos
   veces; su moderación de imagen es asíncrona (punto 6).
4. **Selfie con gesto**: el catálogo de `verification.catalog` (nunca el gesto anterior), 15 min,
   un solo uso, y antes el consentimiento separado **`KYC_SELFIE`** versionado (`2026-11-16`,
   borrador pendiente del abogado); sin él, `400 CONSENT_REQUIRED {kind}` como la verificación de
   personas. Revocarlo borra las selfies guardadas (`media.release`). Los consentimientos pasan a
   ser por tipo de cuenta: `me/consents` y `/legal/current` (persona) no listan `KYC_SELFIE`;
   `/legal/current?accountKind=BUSINESS` solo lista ese.
5. **Teléfono**: puerto `PhoneOtpSender` con adaptadores `disabled` (por defecto: no envía y el
   check `PHONE_VERIFIED` falla → `IN_REVIEW`, **nunca** aprobación automática) y `whatsapp-cloud`
   (Graph API `POST /{version}/{phone-number-id}/messages`, plantilla de autenticación con el código
   en cuerpo y botón; host fijo, `fetch` inyectado como en el antibot; token, id y plantilla por
   entorno). Código de 6 dígitos guardado como SHA-256 salado con el id, 10 min, 5 intentos, 60 s
   entre pedidos y 5 por hora. Pedir un código nunca revela si otro negocio usa el número.
6. **Pipeline síncrono** en `POST /business/me/kyc/submit`: precondiciones `422 KYC_INCOMPLETE
   {missing}`; **locks consultivos** por cada HMAC (NIT, CI, teléfono, correo) **antes** del
   `statement_timeout`, así dos envíos con el mismo NIT nunca se aprueban ambos; `SET LOCAL
   statement_timeout = KYC_CHECK_STATEMENT_TIMEOUT_MS` (500) y presupuesto total
   `KYC_PIPELINE_BUDGET_MS` (2000); cada check en su savepoint: un error o un vencimiento es `ERROR`
   (→ `IN_REVIEW`), nunca rechazo. Checks: `PHONE_VERIFIED`, `DOCUMENTS_READABLE`,
   `DUPLICATE_NIT|PHONE|EMAIL` (FAIL), `DUPLICATE_CI` (WARN), `NAME_SIMILARITY` (trigramas ≥ 0,8 con
   fichas `ACTIVE` del mismo tipo o skeleton `RESERVED`), `ANTIBOT_RISK` (solo LOW pasa),
   `BLOCKLIST`, `CLOSED_ACCOUNT_SANCTION`, `BANNED_TERMS`. Todo PASS → `AUTO_APPROVED`; cualquier
   otro → `IN_REVIEW`. **Resultado atómico**: checks, decisión, historial, cuenta, ficha `ACTIVE` y
   handle `ACTIVE`, aviso y trabajo de moderación del logo (`business.image-moderation`, puerto
   `ImageModerationPort` con adaptador Noop que responde `UNAVAILABLE`) en **una** transacción.
   `kyc_checks.detail` lleva códigos y conteos, nunca datos personales. Al negocio solo se le
   muestran los códigos que puede corregir (`userFacingCodes`); `BLOCKLIST` y sanciones, nunca.
7. **Máquina de estados** (plan §2.5) en `kyc-state-machine.ts`; todo lo demás es
   `409 KYC_INVALID_TRANSITION`. `AUTO_APPROVED` = insignia «Nuevo»; `APPROVED` (decisión humana) =
   `is_verified` («Verificado por REPP»). Reenvío: solo tras un `REJECTED` con `allowResubmit`,
   máximo **3 intentos**, **24 h** después de la decisión; copia datos y documentos salvo la selfie.
   **Cambio material** (nombre, categoría, razón social, NIT, representante) de un negocio aprobado:
   `POST /business/me/kyc/changes` abre una versión nueva (copia todo) que **nunca se autoaprueba**
   (`MATERIAL_CHANGE` WARN); la versión vigente sigue publicada hasta que REPP aprueba la nueva, y
   entonces pasa a `SUPERSEDED` (terminal) y sale de las colas. **Solo se toma o decide la versión
   abierta o la vigente** (`current_submission_id`); un id viejo responde `409
   KYC_SUBMISSION_SUPERSEDED` en vez de reaprobar o pisar la cuenta, un cambio solo se aprueba
   mientras la versión que cambia sigue aprobada, y una cuenta suspendida o cerrada no se decide
   (`409 BUSINESS_ACCOUNT_LOCKED`; se reactiva desde la consola de cuentas).
8. **Consola REPP** `admin/business/*` (`PLATFORM_MODERATION_ROLES`): colas `REVIEW` (`IN_REVIEW`,
   por `review_due_at` = envío + `BUSINESS_KYC_REVIEW_SLA_HOURS` horas hábiles lun–vie en
   `BUSINESS_TIME_ZONE`, sin feriados) y `POST_REVIEW` (`AUTO_APPROVED`, por `post_review_due_at` =
   + `BUSINESS_KYC_POST_REVIEW_SLA_HOURS`), claim/release (30 min de vigencia, `409
   KYC_CLAIMED_BY_OTHER`), decisión con motivos y `allowResubmit`, detalle con los datos en claro y
   visor que descifra y entrega `no-store`/`inline`; **cada lectura del detalle y cada vista de
   documento escribe su fila en `admin.audit_log` antes de responder**. Suspender/reactivar,
   reservas y renombre forzado de handles (el viejo se retira **sin** redirección y bloqueado 180
   días), lista negra (solo HMAC; nunca se guarda ni devuelve el valor) y términos prohibidos.
   ADR-0018 §8: nadie revisa su propio negocio — la cuenta del actor o un negocio dado de alta con
   el mismo buzón canónico del actor → `403 MODERATION_SELF_CASE`, también en suspender, reactivar
   y el renombre forzado de su handle. Métricas en `/health/metrics`:
   tamaño, vencidos y edad p95 por cola, tasa de autoaprobación de 7 días.
9. **Retención** (paso KYC del worker `privacy-retention`, borrado por `media.release`): DRAFT
   abandonado 30 días, intento rechazado 30 días (documentos y datos cifrados), selfie 30 días tras
   la decisión, versión aprobada reemplazada 30 días, negocio cerrado 180 días, códigos de teléfono
   sin verificar 1 día. Constantes `KYC_RETENTION`, **propuestas pendientes del abogado (Q5)**.
   Decisiones, checks, historial y huellas (sin imagen ni dato en claro) se conservan.
10. **Catálogos de cuenta**: el cierre de una persona (moderador) libera sus tomas, conserva sus
    decisiones y quita su nombre de la lista negra y de los términos; la exportación tiene las
    secciones KYC del negocio (sin cifrados, HMAC, moderador ni checks). El cierre y la exportación
    de la cuenta de negocio llegan en 8f.

## Fuera de esta fase

Cancelación de órdenes al suspender (8d), prioridad de cola por afiliaciones pendientes (8e),
verificación contra SIN/SEGIP/SEPREC (sin integración conocida), cotejo facial automático (lo hace
REPP en la revisión posterior), rotación de `KYC_ENCRYPTION_KEY` (versión de clave por decidir).

## Consecuencias

- Contrato nuevo `business/me/kyc/*`, `business/me/phone/verify/*` y `admin/business/*`
  (`docs/endpoints/endpoints.md`, `openapi.yaml`). Cambian: `GET /legal/current` (consentimientos
  por tipo de cuenta), `PATCH /business/me/profile` (409 con `details.action`) y
  `PUT /business/me/handle` (409 `KYC_NOT_EDITABLE` en revisión).
- Rollback: `yarn migration:down` encola en `media.release` cada documento todavía guardado (el
  chequeo de referencias tolera la tabla ausente) y elimina tablas, columna, índice y
  consentimientos `KYC_SELFIE`; los negocios ya aprobados siguen publicados.

## Continuación en 8f (cierre del negocio)

[ADR-0028](./ADR-0028-cierre-exportacion-y-retencion-del-negocio.md) abre `me/account/*` (salvo `PATCH`) y `me/export/*` al negocio y define su cierre, su exportación, la retención del KYC por entorno (con los 5 años de los registros), el borrado del KYC a pedido, la contracción de `payment_orders.receipt_url`, el tope de pedidos abiertos de un negocio no verificado y el fin de las afiliaciones cuando cierra un gimnasio o un coach (`BUSINESS_CLOSED`).
