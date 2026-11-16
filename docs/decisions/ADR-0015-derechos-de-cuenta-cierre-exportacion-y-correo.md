# ADR-0015 — Derechos de cuenta: cierre, exportación, cambio de correo y sanciones que sobreviven al cierre

Estado: aceptado · Fecha: 2026-11-18 · Relacionado: [ADR-0005](ADR-0005-messaging-transactional-outbox.md),
[ADR-0010](ADR-0010-minio-immutable-media.md), [ADR-0014](ADR-0014-privacidad-retencion-y-consentimientos.md)

## Contexto

La franja 4 da a cada socio tres derechos: llevarse sus datos, cambiar el correo y cerrar la cuenta.
Los tres tocan muchas tablas y archivos que no entran en una transacción, y el cierre abría una
evasión: quien acumulaba sanciones cerraba la cuenta y se registraba con el mismo correo, sin faltas.

## Decisión

### 1. Cierre en una transacción, guiado por un catálogo

- `src/modules/account/account-closure.catalog.ts` lista cada tabla que referencia una cuenta con su
  destino (`DELETED`, `ANONYMIZED`, `KEPT`). El mismo predicado alimenta la vista previa y el borrado;
  una e2e falla si aparece una tabla con FK a `usuarios` fuera del catálogo.
- La fila de `usuarios` queda (ancla los registros fiscales del gimnasio) con correo lápida
  `cerrada-<id>@cuenta-cerrada.invalid`, sin datos personales y con un hash de contraseña aleatorio,
  así el correo puede volver a registrarse. Las cuentas del personal no se cierran desde la app (403).
- Prueba: contraseña, o PIN por correo para cuentas creadas con Google/Apple.

### 2. Archivos: una sola cola, `media.release`

- Los binarios del cierre se encolan en la misma transacción en `media.release`
  (`MediaReleaseService`), **un trabajo por archivo**: el mismo mecanismo que borra el adjunto de un
  mensaje «para todos» (ADR-0014). Se retira la cola `account.media-erasure`, que agrupaba hasta 100
  claves por trabajo: un archivo que fallaba reintentaba los otros 99 y un dead-letter dejaba lotes
  enteros sin borrar. `media.release` guarda el proveedor de cada clave (no borra en otro almacén),
  valida el sobre con Zod, reintenta 8 veces con backoff y termina en dead-letter.
- El borrado pasa por `MediaRetentionService`: sólo si ninguna otra fila referencia el archivo, y con
  almacenamiento inmutable (ADR-0010) el binario se conserva y queda en el log.

### 3. Exportación y cambio de correo

- La exportación es asíncrona (cola `account.export`, worker `account-data`), una por día, sólo
  filas propias, sin hashes de credenciales, con tope por tabla; el archivo caduca y se purga.
- El correo cambia en dos pasos: la contraseña autoriza y un PIN enviado al **correo nuevo** lo
  prueba; el correo anterior recibe el aviso. Un correo ocupado responde 409 recién al confirmar,
  para que la solicitud no sirva para sondear qué correos existen.

### 4. Las sanciones sobreviven al cierre

- Al cerrar, si la cuenta tiene una suspensión en curso o faltas dentro de la ventana de la escalera
  de moderación (`STRIKE_LIFETIME_DAYS` = 365), se guarda en `moderation.closed_account_sanctions`:
  `email_hmac`, `suspended_until`, `strike_count`, las faltas vigentes (tipo, motivo, gimnasio,
  vencimiento; sin nota, objetivo ni moderador) y `expires_at` = fin de la ventana (el vencimiento
  más lejano). Sin sanción, no se guarda nada.
- `email_hmac` = `HMAC-SHA256(IP_HASH_SECRET, "email:" + correo canónico)`. El correo canónico
  (`canonicalEmail`) une los alias de un mismo buzón: minúsculas, sin el `+sufijo` de la parte
  local y, en Gmail (`gmail.com` y `googlemail.com` son un buzón y Gmail ignora los puntos), sin
  puntos y con el dominio unificado. Sólo se usa para el hash; el correo se sigue enviando tal cual. `IP_HASH_SECRET` pasa
  a ser el **pepper de privacidad** de la API (IP y correo); el prefijo separa los dominios. No se
  crea `EMAIL_HASH_SECRET`: un secreto más que rotar sin beneficio. Sin el secreto no se guarda el
  registro (un hash sin clave de un correo se revierte por diccionario) y el log avisa
  `moderation.closed_sanction_not_recorded`: **producción debe configurar `IP_HASH_SECRET`**.
- Al registrarse con contraseña o completar Google/Apple, si el HMAC del correo coincide con un
  registro vigente, la cuenta nueva recibe en la misma transacción copias de las faltas (con su
  vencimiento original y la nota «Heredada de una cuenta cerrada…»), de modo que la escalera las
  cuenta sin cambios en moderación, y la suspensión hasta `suspended_until`. El registro se consume.
  Si la suspensión sigue en curso la cuenta se crea pero el alta responde 403 como el login, sin
  sesión.
- `yarn db:privacy:retention` borra los registros vencidos.
- **Cambio de correo con sanción vigente:** `POST /me/email/change` (y su confirmación, bajo el
  bloqueo de la cuenta) responde 409 `EMAIL_CHANGE_BLOCKED_BY_SANCTION` mientras haya una
  suspensión en curso o faltas dentro de la ventana. Así no se puede cambiar a un correo que nunca
  se vuelve a usar, cerrar y registrarse limpio con el original. La suspensión ya cierra la sesión
  en cada petición; el bloqueo cubre sobre todo las advertencias.
- **Cierre por moderación (menor confirmado, cola `account.minor-closure`, worker `account-data`):**
  `AccountClosureService.closeByModeration` corre la misma transacción de borrado sin contraseña ni
  PIN, sólo para socios, e idempotente si la cuenta ya está cerrada. **No guarda registro de
  sanción**: el cierre es el resultado de la revisión, y la suspensión indefinida «pendiente de
  revisión» guardada bajo el hash del correo dejaría a la persona fuera para siempre cuando ya sea
  adulta.

## Consecuencias y reversión

- Migración `202611180301`: crea `moderation.closed_account_sanctions` y completa el *contract* de
  ADR-0014 (borra `training.routine_progress_download_audits.ip`; la vista
  `v_audit_routine_progress_downloads`, que nadie lee en el código, expone `ip_hmac`). Rollback: borra
  la tabla y recrea `ip` **vacía** con la vista anterior.
- Riesgo residual aceptado: un cambio de correo hecho **sin** sanción vigente y una sanción
  posterior dejan el registro bajo el correo nuevo; registrarse con el anterior empieza limpio,
  porque el sistema no guarda correos anteriores. El cambio con sanción vigente está bloqueado y los
  alias (`+sufijo`, puntos de Gmail) ya no sirven para evadir. Los registros guardados antes de la
  forma canónica conservan su hash anterior: sólo difieren si el correo tenía alias.
- Rotar `IP_HASH_SECRET` deja sin efecto los registros existentes (no se pueden recalcular).
