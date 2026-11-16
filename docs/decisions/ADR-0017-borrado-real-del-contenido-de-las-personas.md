# ADR-0017 — Borrado real del contenido de las personas

Estado: **aceptado**
Fecha: 2026-11-16
Reemplaza en parte a [ADR-0010](./ADR-0010-minio-immutable-media.md): su §4 («inmutabilidad en
tres capas») deja de regir para el contenido de las personas y sigue rigiendo para el catálogo.
Afecta a [ADR-0014](./ADR-0014-privacidad-retencion-y-consentimientos.md) §5 y a
[ADR-0015](./ADR-0015-derechos-de-cuenta-cierre-exportacion-y-correo.md) §2.

## Contexto

ADR-0010 fijó que las imágenes subidas **nunca se borran**, con tres capas: el usuario MinIO de la
API sin `s3:DeleteObject`, el bucket versionado y un `remove()` del adaptador que no hacía nada. El
puerto lo declaraba con `readonly immutable: boolean`, y con MinIO toda la retención se quedaba en
la fila: la foto salía de la galería, el mensaje «para todos» desaparecía y la cuenta se cerraba,
pero el binario seguía en el almacén. ADR-0014 §5 tuvo que advertir que los textos no podían
prometer el borrado en esa configuración.

El 2026-11-16 el responsable de producto decidió: **lo que sube una persona tiene que poder
borrarse de verdad.** La decisión deja sin efecto el requisito «las imágenes nunca se borran» para
ese contenido. Lo administrado (mediateca del gimnasio, dataset de ejercicios) no lo sube una
persona y conserva la inmutabilidad.

## Decisión

### 1. Qué se borra y qué no, por clave

| Prefijo | Qué es | Con MinIO |
|---|---|---|
| `users/{userId}/perfiles/…`, `stories/`, `reels/`, `publicaciones/`, `chats/{conversationId}/…`, `ejercicios/{exerciseId}/…` | Contenido de la persona (incluidas las subidas a sus ejercicios personales, §7, y las selfies de verificación cuando exista ese módulo, que debe guardarlas bajo `users/{userId}/`) | **Se borra**: todas las versiones |
| `catalog/…` | Mediateca del administrador y dataset espejado | No se borra (ADR-0010) |
| `ejercicios/{exerciseId}/…` | Demostraciones del catálogo de ejercicios (ejercicios globales) | No se borra (ADR-0010) |

La regla es «bajo `users/` se borra; fuera, no». Una clave con segmentos `..`, vacíos o
codificados no cuenta como `users/` aunque empiece así (`isSafeStorageKey`).

### 2. El puerto pregunta por clave

`readonly immutable: boolean` se reemplaza por `canRemove(key: string): boolean`. El almacén ya no
es todo inmutable o todo borrable: la respuesta depende de la clave.

- Adaptador local: `true` para toda clave dentro de la raíz (como antes).
- Adaptador MinIO: `true` sólo si la clave es de una persona y el despliegue declara el borrado
  (§4). Para una clave del catálogo, `remove()` es un no-op con el log
  `media.remove.immutable_key` (`reason: catalog_key`).
- `MediaRetentionService` pregunta antes de borrar: si el almacén conserva la clave, informa
  `media.retention.file_kept` con `reason: storage_keeps_key` y `fileRemoved: false`, en vez de
  anunciar un borrado que no ocurrió. El recuento de referencias de `MediaReferencesRepository` y
  el bloqueo consultivo se mantienen: un archivo que otra fila referencia no se borra.

### 3. Borrar en un bucket versionado es borrar todas las versiones

El bucket sigue versionado: protege una sobrescritura accidental y el catálogo. Pero en un bucket
versionado un `DELETE` sin `versionId` no borra nada: apila un *delete marker* sobre la versión,
que sigue entera y recuperable. Por eso el adaptador:

1. lista las versiones con `prefix = key` exacto e `IncludeVersion` (`listObjects` del SDK
   `minio` 8.0.7, sin dependencias nuevas), y se queda **sólo con las de nombre idéntico** a la
   clave: un hermano `<key>.bak` no se toca;
2. borra cada una con `removeObject(bucket, key, { versionId })`, **delete markers incluidos**;
   en un bucket sin versionado el id es `"null"`, que S3 acepta;
3. si una llamada falla, se detiene y **lanza**. El reintento vuelve a listar, así que una pasada
   parcial converge; una lista vacía es éxito (idempotente).

Al terminar no queda ninguna versión de la clave: nada recuperable con las credenciales de la API
ni con las de root.

### 4. Un borrado rechazado nunca es un éxito silencioso

Si el servidor rechaza el borrado (`AccessDenied` porque operaciones todavía no aplicó la política
del §6, red caída), el error se propaga:

- en la cola `media.release` (mensaje «para todos», cierre de cuenta, retención de contenido
  denunciado, evidencia vencida) el trabajo falla, reintenta 8 veces con backoff y termina en
  **dead-letter**, visible. Antes, con el no-op, se completaba sobre un archivo que seguía ahí;
- los borrados que la persona pide en el momento (una foto de perfil, una story, la purga de
  stories, una subida a un ejercicio personal) ya no llaman al almacén dentro de la petición: en la
  transacción que borra la fila toman el bloqueo consultivo de la clave y, si ninguna otra fila la
  referencia, encolan el mismo `media.release` (`MediaReferenceReleaseService`). La llamada responde
  éxito en cuanto la referencia cae; un fallo del almacén se reintenta con backoff y termina en
  dead-letter, visible. La retención de evidencia (`holdIfReported`) y el recuento de referencias
  siguen decidiendo si se encola.

### 5. Configuración: `MEDIA_USER_CONTENT_DELETABLE`

Se agrega una sola variable, `MEDIA_USER_CONTENT_DELETABLE` (`true` | `false`, sin otras grafías).
Se eligió declarar en vez de sondear: preguntarle a MinIO si se puede borrar exige borrar algo, y
la política del usuario no se puede leer con sus propias credenciales.

- Proveedor local: se ignora; el disco siempre borra.
- MinIO fuera de producción: sin valor vale `true`.
- MinIO en producción: **obligatoria y explícita**. Sin valor, el esquema de entorno detiene el
  arranque. La variable afirma algo del servidor («el usuario de la API puede borrar bajo
  `users/*`»), y esa afirmación tiene que hacerla quien aplicó la política, no un valor por defecto.
- `false` conserva el contenido de las personas como en ADR-0010 (`reason:
  user_content_not_deletable`). Es un modo de transición, no una opción de producto: con `false`
  **ningún texto puede prometer el borrado del archivo**, y todo lo que dependa de poder borrarlo
  (por ejemplo, una verificación con selfie) tiene que preguntar `canRemove("users/…")` y negarse
  si la respuesta es `false`.

### 6. Protección de la evidencia de moderación

La evidencia ya no la protege el almacén sino la base de datos, y sólo durante su plazo:

- una foto, story o comentario denunciado se **retiene** en vez de borrarse mientras la denuncia
  está abierta (`holdIfReported`), y su fila mantiene la referencia al archivo; lo mismo las
  subidas a un ejercicio personal denunciado (`holdIfExerciseReported`, §7);
- la copia de un mensaje denunciado vive en `moderation.chat_message_evidence`, que
  `MediaReferencesRepository.isReferenced` consulta;
- la retención de contenido denunciado y la purga de evidencia liberan el archivo por
  `media.release` 180 días después de cerrar la última denuncia.

Mientras alguna fila lo referencia, `MediaRetentionService` no llama a `remove`. Pasado el plazo,
se borra como cualquier otro contenido de la persona.

### 7. Las subidas a ejercicios personales son de la persona

Un socio puede subir archivos a su ejercicio **personal** (`POST /exercises/:id/media/upload`). Eso
es contenido suyo, no catálogo: se guarda bajo `users/{ownerUserId}/ejercicios/{exerciseId}/`
(`MediaUploadTarget` con `ownerUserId`), y se borra —fila y archivo por `media.release`— al borrar
esa media, al borrar el ejercicio, al reemplazarla con una nueva subida de la misma identidad y al
cerrar la cuenta (paso `training.exercise_media` del catálogo de cierre, que libera el archivo y su
póster `thumbnail_url`). La lectura anónima de
MinIO cubre `users/*/ejercicios/*` igual que cubría `ejercicios/*`. Lo que sube un administrador a
un ejercicio global sigue bajo `ejercicios/{exerciseId}/`, inmutable.

Si el ejercicio tiene una denuncia (`target_kind = 'EXERCISE'`) **abierta**, borrar su media o el
ejercicio no la destruye: la fila queda retenida (`author_deleted_at`, `INACTIVE`, sin
`external_id` para que una nueva subida cree otra fila) con su archivo, y no se encola ninguna
liberación. Al cerrar la cuenta, un ejercicio con denuncia se conserva junto con sus subidas. La
retención de contenido denunciado borra esas subidas (archivo y póster) y luego el ejercicio, si
nadie más lo usa, 180 días después de cerrarse la última denuncia.

Las filas subidas antes de este cambio **conservan su clave** bajo `ejercicios/`: no se mueven
archivos ni se reescriben URLs (una migración de datos sobre un almacén inmutable no podría borrar
el original). Esos archivos siguen sin poder borrarse; al borrar su media o su ejercicio, la fila
sólo se desactiva, como antes.

## Runbook de operaciones (lo aplica el equipo; esta sesión no puede)

En producción el media lo sirve `datacenter-minio`. Con el alias `mc` de root de ese servidor
(`gs` abajo) y el bucket `gymsheet-media`:

1. Escribir la política de la API (`gymsheet-api.json`). Lo nuevo son la tercera y la cuarta
   sentencia; `s3:ListBucketVersions` es una acción del bucket, así que se acota a `users/` con la
   condición `s3:prefix`:

   ```json
   {
     "Version": "2012-10-17",
     "Statement": [
       {
         "Effect": "Allow",
         "Action": ["s3:PutObject", "s3:GetObject"],
         "Resource": ["arn:aws:s3:::gymsheet-media/*"]
       },
       {
         "Effect": "Allow",
         "Action": ["s3:ListBucket"],
         "Resource": ["arn:aws:s3:::gymsheet-media"]
       },
       {
         "Effect": "Allow",
         "Action": ["s3:DeleteObject", "s3:DeleteObjectVersion"],
         "Resource": ["arn:aws:s3:::gymsheet-media/users/*"]
       },
       {
         "Effect": "Allow",
         "Action": ["s3:ListBucketVersions"],
         "Resource": ["arn:aws:s3:::gymsheet-media"],
         "Condition": { "StringLike": { "s3:prefix": ["users/*"] } }
       }
     ]
   }
   ```

2. Cargarla y asociarla al usuario de la API (`create` reemplaza una política existente con el
   mismo nombre):

   ```sh
   mc admin policy create gs gymsheet-api gymsheet-api.json
   mc admin policy attach gs gymsheet-api --user "$MINIO_ACCESS_KEY"
   mc admin policy info gs gymsheet-api
   ```

3. Comprobar con las credenciales **de la API** (alias `api`), no con las de root:

   ```sh
   echo prueba | mc pipe api/gymsheet-media/users/ops-check/prueba.txt
   mc ls --versions api/gymsheet-media/users/ops-check/prueba.txt   # lista versiones
   mc rm --versions --force api/gymsheet-media/users/ops-check/prueba.txt   # debe borrar
   mc ls --versions api/gymsheet-media/users/ops-check/   # debe quedar vacío
   mc rm api/gymsheet-media/catalog/ops-check.txt   # debe responder Access Denied
   ```

   La política de lectura anónima del bucket debe incluir `users/*/ejercicios/*` (§7), como la que
   aplica `minio-init`.

4. Recién entonces poner `MEDIA_USER_CONTENT_DELETABLE=true` en las variables de Coolify y
   redesplegar la API y los workers.
5. Los trabajos `media.release` que hayan terminado en dead-letter antes del paso 2 siguen siendo
   la lista de archivos por borrar. No hay comando para reencolarlos; una vez aplicada la política,
   con `psql` contra la base de producción:

   ```sql
   UPDATE integration.outbox_jobs
      SET status = 'FAILED', attempt_count = 0, available_at = now()
    WHERE queue_name = 'media.release' AND status = 'DEAD_LETTER';
   ```

   Los archivos que la configuración anterior conservó (`media.retention.file_kept` con
   `reason: immutable_storage`) no tienen trabajo: el log de ese período identifica sus claves, y
   se borran con `mc rm --versions --force` tras comprobar que ninguna fila los referencia.

`minio-init` de `docker-compose.coolify.yml` (perfil `media`) aplica la misma política al
desplegar el MinIO propio del stack.

## Consecuencias

- (+) El derecho de supresión se cumple en el almacén: borrar un mensaje, una foto o una cuenta
  borra el binario y todas sus versiones, sin intervención con credenciales de root.
- (+) Un fallo de permisos queda visible en dead-letter en vez de completarse en silencio.
- (+) El catálogo conserva las tres capas de ADR-0010: el código lo rechaza y el servidor también.
- (−) La API puede borrar bajo `users/*`: un bug que llame a `remove` con una clave de persona
  referenciada sólo lo frena `MediaReferencesRepository`, no el servidor.
- (−) El borrado no tiene papelera: no hay versión previa a la que volver.
- Reversión: `MEDIA_USER_CONTENT_DELETABLE=false` y quitar las dos sentencias nuevas de la
  política devuelve el comportamiento de ADR-0010 para lo que se borre de ahí en adelante; lo ya
  borrado no vuelve.
