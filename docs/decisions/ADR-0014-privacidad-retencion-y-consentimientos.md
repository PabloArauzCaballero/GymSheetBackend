# ADR-0014 — Retención de datos personales, registro de consentimientos y hash del texto aceptado

Estado: aceptado · Fecha: 2026-11-18 · Amplía [ADR-0013](ADR-0013-antibot-alta-de-cuentas.md)

## Contexto

Los textos legales para Bolivia sólo pueden prometer lo que el código hace. El mapa de datos de la
franja 4 encontró cinco promesas sin respaldo: IP en claro sin plazo (recuperación de contraseña,
bitácora de administración, descargas de entrenadores), ningún job que borrara el HMAC de IP a los
90 días, un consentimiento de salud obligatorio y sin versión, ningún registro de consentimientos
sensibles (orientación, ubicación precisa, selfie) y ningún hash del texto aceptado. Además, apagar
el mapa sólo ocultaba la última coordenada y borrar un mensaje «para todos» dejaba el binario cifrado
en el almacenamiento.

## Decisión

### 1. Nunca IP en claro; HMAC con plazo de 90 días

- Toda IP que se guarda es `HMAC-SHA256(IP_HASH_SECRET, ip)` (`src/common/privacy/client-ip-hash.ts`).
  Sin secreto, no se guarda nada (`null`).
- Migración `202611180201`: `ip_hmac` en `public.password_reset_tokens`, `admin.audit_log` y
  `training.routine_progress_download_audits`. Las IP existentes se convierten con el secreto
  **configurado al correr la migración**; sin secreto se anulan (no hay con qué firmarlas).
  `solicitado_desde_ip` y `audit_log.ip` se eliminan. La auditoría de descargas conserva su columna
  `ip` vacía (paso *expand*): el módulo `export` todavía la escribe, y el comando de retención la
  convierte en HMAC en cada pasada. Cuando `export` escriba `ip_hmac`, una migración posterior la
  elimina (*contract*).
- `admin.audit_log` es de sólo inserción: anular su HMAC a los 90 días es la única modificación
  permitida, y es minimización exigida por la política, no edición del rastro (actor, acción,
  objetivo y fecha se conservan).
- **Turnstile** sigue recibiendo la IP en claro (`remoteip`): Cloudflare la necesita para validar el
  desafío. Viaja una vez por alta web, no se guarda en REPP y figura en el mapa de datos y en la
  política de privacidad como dato enviado a Cloudflare.

### 2. Un comando general de retención

`yarn db:privacy:retention` (alias `yarn db:signups:retention`, mismo binario
`dist/workers/privacy-retention.command.js`) reemplaza al de la franja 3. Un solo disparo, a diario:

- borra tokens antibot gastados de más de 1 día;
- anula todo HMAC de IP de más de 90 días en `auth.signup_audit`, `auth.terms_acceptances`,
  `auth.user_devices.last_ip_hmac`, `public.password_reset_tokens`, `admin.audit_log` y
  `training.routine_progress_download_audits` (lista única en `privacy-retention.repository.ts`,
  con índice parcial por tabla);
- convierte la IP cruda que aún llegue a la auditoría de descargas.

El log lleva conteos por tabla, nunca valores.

### 3. Registro de consentimientos (`auth.consents`)

Una fila por otorgamiento: `user_id`, `kind` (`HEALTH | ORIENTATION | VERIFICATION_SELFIE |
PRECISE_LOCATION`), `version`, `granted_at`, `revoked_at`, `channel`. A lo sumo una abierta por
persona y tipo (índice único parcial). Las versiones vigentes viven en
`src/modules/legal/consent-versions.ts` y salen en `GET /legal/current`.

- Otorgar exige la versión vigente (`409 CONSENT_VERSION_OUTDATED`); repetirla no agrega filas; una
  versión nueva cierra la anterior y abre otra.
- **Revocar borra el dato en la misma transacción**: `HEALTH` → texto de consideraciones físicas y
  `consent_health`; `ORIENTATION` → orientación y su visibilidad; `PRECISE_LOCATION` → última
  coordenada del mapa y apaga el mapa; `VERIFICATION_SELFIE` → sólo se registra (la función llega en
  la franja 6).
- Guardar una orientación o una ubicación del mapa exige el consentimiento abierto
  (`400 CONSENT_REQUIRED`). La comprobación toma `FOR SHARE` sobre la fila del consentimiento dentro
  de la transacción de la escritura: una revocación concurrente espera y luego borra lo escrito.
- El consentimiento de salud deja de ser obligatorio para completar el onboarding. Sólo se exige si
  se envían consideraciones físicas; sin él el texto no se guarda.
- Un consentimiento dado a una versión anterior sigue vigente y se informa con `upToDate: false`
  para que el cliente vuelva a preguntar. La migración crea filas `LEGACY` para lo que ya existía
  (salud aceptada, orientación guardada, mapa encendido).
- Las sentencias de borrado viven en `consents.repository.ts` y tocan tablas de onboarding y social
  a propósito: revocación y borrado son atómicos, y los módulos dueños dependen de `consents`, no al
  revés.

### 4. Hash del contenido aceptado

`LEGAL_DOCUMENT_CONTENT_SHA256` acompaña a cada versión de `TERMS` y `PRIVACY`; se fija al publicar
con `yarn legal:hash <archivo>`. `auth.terms_acceptances.content_sha256` lo guarda con cada
aceptación y `GET /legal/current` lo devuelve. Los textos `2026-08-25` se publicaron antes de esto y
no están en el repositorio: su hash es `null` en vez de inventado, y las aceptaciones previas quedan
con `null`.

### 5. Borrar de verdad

- Apagar el mapa (o el perfil social, que lo apaga) borra la fila de `social.map_locations`. La
  migración borra las coordenadas de quienes ya tenían el mapa apagado.
- Borrar un mensaje «para todos» encola, en la misma transacción, un trabajo `media.release` en el
  outbox (8 intentos con backoff, luego dead-letter). `MediaReleaseService` lo drena desde la API
  cada minuto y borra el binario a través de `MediaRetentionService` (respeta el recuento de
  referencias). Con almacenamiento inmutable (ADR-0010) el binario **se conserva** y queda en el log:
  los textos no pueden prometer el borrado del archivo en esa configuración.

## Consecuencias y reversión

- Rollback de `202611180201`: elimina `auth.consents`, `content_sha256`, los índices y `ip_hmac`, y
  recrea `solicitado_desde_ip` y `audit_log.ip` **vacías**. Un HMAC no se revierte y las coordenadas
  borradas no vuelven.
- Clientes: `GET /legal/current` agrega `contentSha256` y `consents`; el onboarding acepta
  `consentHealthVersion`; aparecen `CONSENT_REQUIRED` y `CONSENT_VERSION_OUTDATED`.
- Quedan fuera: borrar el binario de mensajes temporales al vencer, y las demás purgas del mapa de
  datos sin plazo definido.
