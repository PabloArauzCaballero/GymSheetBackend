# Plan — MinIO como almacén de media inmutable en el VPS

Fecha: 2026-09-13 · Rama base: `dev` · Estado: **ejecutado en dev (2026-09-14)**

## Estado

B0, B1 y B3 hechas; B2 resultó innecesaria (ver abajo). MinIO corre en el VPS y la API ya
escribe ahí. Verificado de extremo a extremo el 2026-09-14:

- Subida real por `POST /me/photos` → clave
  `users/6e93af87…/perfiles/c414cd0e….png`, exactamente el layout previsto.
- La foto se ve en `https://gymsheet-media.taila8f993.ts.net/gymsheet-media/…` (200) y el
  **listado anónimo del bucket está denegado** (403): sin enumeración, la clave por
  SHA-256 no se adivina.
- El socio borra la foto por la API → la galería queda vacía **y el objeto sigue
  devolviendo 200**. El log dice `media.retention.file_kept · reason: immutable_storage`.
- Con las credenciales de la API, `mc rm` responde `Access Denied` y el objeto permanece.
- Incluso con root, un borrado solo crea *delete markers*: el versionado conserva las
  versiones.

Pendiente: **B4 (respaldo y vigilancia de disco)** y, opcionalmente, B5.

Dos trampas que costaron un despliegue fallido cada una y que conviene no reaprender:

1. **Compose interpola el fichero entero antes de aplicar los perfiles**, así que un
   `${VAR:?}` en un servicio que el perfil excluye rompe el despliegue completo.
2. **`minio` es un nombre genérico en una red compartida.** Había otros dos MinIO en la
   red `coolify` del VPS; el Funnel resolvía al almacén ajeno y devolvía 403 para una
   ruta que en el nuestro era pública. Mismo bug que postgres/redis en `a332390`. Nada
   debe usar `minio` a secas como hostname: es `gymsheet-minio`.
3. **MinIO ya no se publica en Docker Hub**; hay que bajarlo de `quay.io/minio/minio`.

## Objetivo

1. Levantar **MinIO** en el VPS (100.101.207.88, stack Coolify) como almacén de todas las
   imágenes/vídeos subidos por usuarios.
2. Garantizar que los objetos subidos **nunca se borran** (inmutabilidad), aunque el
   producto borre la fila (story caducada, foto quitada, mensaje eliminado).
3. Organizar los objetos **por usuario** con carpetas por categoría:
   `perfiles` (público), `stories`, `publicaciones` (prefijo reservado, ver nota) y
   `chats` (todo chat).

## Punto de partida (auditoría 2026-09-13)

- Sistema de media ya existente con **puertos y adaptadores**
  (`src/modules/media/media-storage.port.ts`): único adaptador real es
  `LocalStorageAdapter` (disco, nombre = SHA-256 del contenido, dedup, `writeFile` con
  `wx`). Los providers `s3`/`cloudinary` están en el enum pero lanzan error si se
  seleccionan (`media-storage.factory.ts:36-41`) — el hueco a rellenar es exactamente ese.
- Consumidores del puerto: fotos de perfil (`POST /me/photos`), stories
  (`POST /me/stories`), chat (`POST /me/conversations/:id/messages/media`) y media admin
  (`POST /admin/media`). **No existe módulo de publicaciones/posts.**
- Borrado actual: `MediaRetentionService.deleteRowAndUnreferencedFile()` con refcount
  cross-tabla y `pg_advisory_xact_lock`; el worker `stories-purge` borra stories >24h.
- Deploy: Coolify + `docker-compose.coolify.yml` (postgres, redis, migrate, api, sidecar
  Tailscale Funnel `gymsheet-backend.taila8f993.ts.net`, workers bajo perfil). Media hoy
  en volumen `media-data` montado solo en `api` y servido por `express.static`.
- Gaps de deploy detectados: (a) el ancla `x-worker-service` no monta `media-data`, así
  que `stories-purge` en el VPS deja ficheros huérfanos; (b) `MEDIA_STORAGE_PUBLIC_BASE_URL`
  default `http://localhost:3000/media` si no se sobrescribe en Coolify; (c)
  `CHAT_MEDIA_MAX_BYTES`/`CHAT_MEDIA_ALLOWED_MIME` no están en el compose ni en
  `.env.example`.
- Deuda estructural: las tablas guardan **URL absoluta** además de
  `storage_provider`/`storage_key` (`profile.photos`, `profile.stories`,
  `chat.messages`, `media.files`, `training.exercise_media`) — cambiar de host/proveedor
  exige migración de datos.

## Decisiones de diseño

### D1 — Layout de claves (un bucket, prefijos por usuario y categoría)

Bucket único `gymsheet-media`, versionado. Clave =
`users/{userId}/{categoria}/{sha256}.{ext}`:

```
users/{userId}/perfiles/{sha256}.jpg          ← fotos de perfil (lectura pública)
users/{userId}/stories/{sha256}.jpg|.mp4
users/{userId}/publicaciones/{sha256}.jpg     ← prefijo RESERVADO (sin feature aún)
users/{userId}/chats/{conversationId}/{sha256}.jpg|.mp4
catalog/{sha256}.{ext}                        ← dataset espejado (ejercicios, gimnasios, admin media)
```

- El nombre por SHA-256 conserva la dedup **dentro de cada carpeta** (el mismo binario
  subido por dos usuarios vive dos veces, a propósito: la propiedad manda sobre la dedup).
- `userId` es siempre el **dueño/emisor** (en chat, quien envía el mensaje).
- Nota "publicaciones": no existe módulo de posts en backend ni en apps (lo "Instagram"
  del producto son stories). Este plan solo reserva el prefijo; crear el módulo de
  publicaciones es un plan aparte.

### D2 — Inmutabilidad ("nunca jamás se borran")

Tres capas, de dentro afuera:

1. **Credenciales de la app sin permiso de borrado**: el usuario MinIO de la API tiene
   policy con `s3:PutObject`/`s3:GetObject` pero **sin `s3:DeleteObject`** — aunque un
   bug llame a `remove()`, MinIO lo rechaza.
2. **Versionado del bucket activado**: una sobrescritura nunca destruye la versión previa.
3. **Adaptador**: `remove(key)` del `MinioStorageAdapter` es **no-op deliberado** (log +
   métrica), documentado en el propio adaptador. `MediaRetentionService` sigue borrando
   la **fila** (el producto no cambia: la story caduca, la foto desaparece de la galería)
   pero el objeto persiste. El refcount de `media-references.repository.ts` deja de
   gatillar borrado físico cuando el provider es `minio`.
4. Root/consola de MinIO solo accesible por tailnet (nunca Funnel) para intervención
   manual excepcional.

### D3 — Visibilidad

- `users/*/perfiles/*`: **lectura anónima** (bucket policy sobre el prefijo) — lo pide el
  producto (avatares/galería visibles en directorio y perfiles públicos).
- Resto de prefijos, Fase 1: lectura anónima también, mismo modelo de seguridad que hoy
  (URLs no adivinables por SHA-256; `express.static` actual ya es público de facto).
- Fase 2 (hardening, opcional pero recomendado): stories y chats pasan a **privado** y
  la API entrega URLs prefirmadas de vida corta al mapear la respuesta. Requiere guardar
  solo `storage_key` y componer la URL en los mappers (aprovechando que
  `media-references.repository.ts` ya compara por sufijo `/{key}`).

### D4 — Origen público

Segundo sidecar Tailscale con Funnel: `gymsheet-media.taila8f993.ts.net` →
`proxy http://minio:9000/gymsheet-media` (mismo patrón que el sidecar `tunnel` de la
API, JSON de serve generado dentro del contenedor). `MEDIA_STORAGE_PUBLIC_BASE_URL`
pasa a `https://gymsheet-media.taila8f993.ts.net`.

### D5 — Extensión del puerto

`upload()` recibe un contexto de destino:

```ts
upload(file, { ownerUserId, category: 'perfiles' | 'stories' | 'publicaciones' | 'chats' | 'catalog', conversationId? })
```

`LocalStorageAdapter` puede ignorarlo (o replicar la estructura en disco, preferible para
que dev y prod se parezcan); `MinioStorageAdapter` lo usa para componer la clave D1. Los
cuatro servicios consumidores ya conocen su `userId`/`conversationId` — cambio mecánico.

## Fases

### B0 — Provisión en el VPS (compose + Coolify) — **implementado**

Los tres servicios (`minio`, `minio-init`, `tunnel-media`) van **apagados por defecto**
tras el perfil `media`, como los workers. Encenderlos = poner las credenciales en Coolify
y añadir `media` a `COMPOSE_PROFILES`.

Trampa verificada durante la implementación: **Compose interpola el fichero entero antes
de aplicar los perfiles**, así que un `${VAR:?}` dentro de un servicio que el perfil
excluye rompe igual el despliegue completo. Por eso las credenciales usan `:-` y el
guardia vive en una comprobación de shell del `command` (`: "${VAR:?mensaje}"`): falla el
contenedor con un mensaje legible en lugar de tumbar el despliegue de la API, y —lo
importante— impide que MinIO arranque con el `minioadmin/minioadmin` por defecto, que con
el Funnel delante sería root abierto al mundo.


- Servicio `minio` en `docker-compose.coolify.yml`: imagen `minio/minio` fijada por
  digest, volumen nuevo `minio-data`, sin `ports:` (regla del compose actual), healthcheck,
  límite de memoria acorde al VPS (~256m), red interna.
- Job `minio-init` (una pasada, como `migrate`): crea bucket `gymsheet-media`, activa
  versionado, crea el usuario de la app con la policy sin-delete (D2.1), aplica la bucket
  policy de lectura pública para `users/*/perfiles/*` (y el resto según fase D3), vía `mc`.
- Sidecar `tunnel-media` (D4).
- Nuevas env en `.env.example` + panel de Coolify: `MINIO_ROOT_USER/PASSWORD` (solo
  init), `S3_ENDPOINT=http://minio:9000`, `S3_ACCESS_KEY/S3_SECRET_KEY` (usuario app),
  `S3_BUCKET=gymsheet-media`, `S3_REGION`, `MEDIA_STORAGE_PUBLIC_BASE_URL`.
- De paso, cerrar los gaps ya detectados: montar `media-data` en `x-worker-service`
  (necesario mientras siga el provider local), añadir `CHAT_MEDIA_*` al compose y a
  `.env.example`, y fijar `MEDIA_STORAGE_PUBLIC_BASE_URL` real en Coolify.
- Verificación por SSH: contenedor sano, `mc admin info`, subida/lectura de un objeto de
  prueba, intento de borrado con credenciales de la app **rechazado**.

### B1 — Adaptador MinIO + contexto de destino

- Dependencia: SDK oficial `minio` (o `@aws-sdk/client-s3`; preferido `minio` por
  simplicidad y compat exacta).
- `src/modules/media/adapters/minio-storage.adapter.ts` implementando el puerto: clave
  D1, `PutObject` idempotente por contenido (HEAD antes de PUT → `reused: true`),
  `remove()` no-op (D2.3).
- Registrar en `media-storage.factory.ts` (`MEDIA_STORAGE_PROVIDER=minio` — añadir al
  enum del env y del puerto; los valores `s3`/`cloudinary` siguen lanzando).
- Extender el puerto y los 4 servicios consumidores con el contexto D5; el
  `LocalStorageAdapter` replica la estructura de carpetas.
- `media-mirror.service.ts` escribe bajo `catalog/`.
- Tests: unit del adaptador (contra MinIO en docker de dev) + e2e de los tres flujos
  sociales; suite de retención ajustada (fila borrada, objeto intacto).

### B2 — Migración de datos existentes — **NO HACE FALTA** (verificado 2026-09-13)

Consulta directa a la base de producción del VPS: `profile.photos`, `profile.stories`,
`chat.messages` (con media) y `training.exercise_media` tienen **cero filas**, y las 3
filas de `media.files` no apuntan a `localhost`. El volumen `media-data` del contenedor
de la API está vacío.

Es decir: **no hay nada que migrar**, y el bug de `MEDIA_STORAGE_PUBLIC_BASE_URL=http://localhost:3000/media`
no llegó a ensuciar ninguna URL persistida. La conmutación se hace en limpio. El script
de migración descrito abajo queda **sin escribir**, deliberadamente: escribir y mantener
un migrador para cero filas es coste sin beneficio, y el plan original lo pedía sólo
porque la auditoría de código no podía saber que el almacén estaba vacío.

Si en el futuro hiciera falta (otro entorno con datos), esto era el diseño:

<details>
<summary>Diseño del migrador, por si alguna vez hay datos que mover</summary>

- Script `db:media:migrate-to-minio`: recorre `profile.photos`, `profile.stories`,
  `chat.messages`, `media.files`, `training.exercise_media`; para cada fila con
  `storage_provider='local'` sube el binario de `storage/media/{key}` a su clave D1
  nueva y actualiza `storage_provider`, `storage_key` y la URL absoluta persistida.
  Idempotente y reanudable (por lotes, ordenado por PK).
- El dataset espejado de ejercicios (miles de ficheros) va a `catalog/` tal cual.
- Ventana: se puede correr en caliente (el adaptador solo afecta a subidas nuevas hasta
  el switch de `MEDIA_STORAGE_PROVIDER`); orden: migrar → verificar muestreo → cambiar
  env → redeploy.
- El volumen `media-data` se conserva congelado como respaldo hasta B4; no se borra.

</details>

### B3 — Conmutación y verificación en el VPS

- `MEDIA_STORAGE_PROVIDER=minio` en Coolify, redeploy vía flujo normal
  (`git push origin dev` → Actions → Coolify).
- Verificación E2E real: subir foto de perfil, story y adjunto de chat desde web y
  móvil; comprobar clave en MinIO (`mc ls`), URL pública de perfil, caducidad de story
  (fila fuera, objeto presente), borrado de foto (ídem).

### B4 — Respaldo y operación

- Backup del volumen `minio-data` en la rutina del VPS y/o `mc mirror --watch` hacia un
  destino externo (segundo disco u off-site). "Nunca se borra" también significa
  sobrevivir a un fallo de disco.
- Métrica/alerta simple de espacio en disco del VPS (los objetos solo crecen; con
  versionado, más aún). Documentar en `docs/despliegue.md`.

### B5 — (Opcional, recomendado) Privacidad de stories y chats

- D3 Fase 2: prefijos privados + URLs prefirmadas en los mappers; guardar solo
  `storage_key` y componer URL al leer (elimina de paso la deuda de URLs absolutas).

## Riesgos y notas

- **Espacio en disco**: inmutabilidad + versionado = crecimiento monótono. B4 es parte
  del plan, no un extra.
- **Vista única en chat** (`viewOnce`): la semántica es de producto (fila/flag), no de
  almacenamiento; el objeto persiste igual que el resto. Confirmado como intencional por
  el requisito "nunca jamás se borran".
- **RGPD/derecho de supresión**: si algún día hace falta borrar datos de un usuario, la
  vía es una intervención manual con credenciales root de MinIO (documentarlo, no
  automatizarlo).
- **Ejecución en VPS**: requiere el acceso SSH ya preparado (llave
  `~/.ssh/id_ed25519_gymsheet_vps`, pendiente de instalar la pública en
  `authorized_keys`).
