# Media — contrato del endpoint de carga y plan de frontend

> Implementado en esta reforma. Arquitectura: [ADR-0007](../decisions/ADR-0007-pluggable-media-storage.md).
> Nota: `docs/endpoints/openapi.yaml` tiene cambios sin commitear de otro trabajo
> (outbox); este contrato se documenta aquí para no interferir y se integrará al
> OpenAPI cuando esa rama se consolide.

## Endpoint

`POST /api/v1/admin/media` — **solo ADMIN** (guards globales `JwtAuthGuard` + `RolesGuard`).

- Content-Type: `multipart/form-data`.
- Campo de archivo: `file` (un solo archivo; límite `MEDIA_UPLOAD_MAX_BYTES`, por
  defecto 5 MiB; MIME en `MEDIA_ALLOWED_MIME`).
- Campos de metadatos (validados con Zod, `.strict()`):
  | Campo | Requerido | Regla |
  |---|---|---|
  | `code` | sí | kebab-case, único (clave natural en `media.files`) |
  | `name` | sí | 1–180 |
  | `altText` | sí | 1–300 |
  | `license` | no | default `Propietaria` |
  | `attribution` | no | default `GymSheet` |
  | `width`,`height` | no | ambos o ninguno, positivos (CHECK `ck_media_dimensions`) |

### Respuesta (200)

```jsonc
{
  "archivo": {
    "id": "uuid", "publicId": "uuid", "codigo": "plan-basic-cover",
    "nombre": "...", "tipo": "IMAGE", "mimeType": "image/jpeg",
    "proveedor": "local", "origen": "MANAGED",
    "url": "http://localhost:3000/media/<sha256>.jpg",
    "altText": "...", "width": null, "height": null,
    "licencia": "Propietaria", "atribucion": "GymSheet", "estado": "ACTIVE"
  },
  "almacenamiento": {
    "proveedor": "local", "clave": "<sha256>.jpg",
    "checksum": "<sha256>", "bytes": 12345, "reutilizado": false
  }
}
```

`reutilizado: true` en cargas repetidas del mismo binario (idempotencia por contenido).

## Idempotencia

- **Adaptador**: nombre de archivo = `sha256(contenido)`; re-subir el mismo binario no
  duplica ni cambia la URL.
- **Base de datos**: upsert por `code`; re-subir con el mismo `code` reconcilia los campos
  gestionados sin crear filas nuevas.

## Mirroring de media externa (dejar de servir desde el repo/host externo)

`yarn db:media:mirror [--apply]` (prod: `db:media:mirror:prod`) copia a nuestro
almacenamiento las filas de `media.files` que hoy se sirven desde un origen
externo (`storage_url IS NULL`). Motivación: las portadas de planes venían de
Unsplash con `auto=format`, que ante el `Accept` de un navegador negocia a
**AVIF** — formato que no renderiza en varios clientes ("imágenes caídas por el
formato"). El mirror descarga forzando `Accept: image/jpeg,image/png`
(SSRF-allowlist `MEDIA_MIRROR_ALLOWED_HOSTS`), valida que sea imagen, guarda vía
`MediaStorageProvider` y popula `storage_url` — el mapper ya prefiere esa URL, así
que el frontend pasa a recibir un **JPEG estable desde nuestro origen**.

- Idempotente: solo procesa filas sin `storage_url`; el adaptador deduplica por
  sha256. Segunda corrida → `candidates=0`.
- Preserva procedencia: `source_url`, `source_name`, licencia y atribución intactos.
- Verificado en Docker: 3 portadas migradas, servidas `200 image/jpeg` desde
  `/media/<sha256>.jpg`; re-ejecución `candidates=0`.
### Media de ejercicios (`training.exercise_media`) — también local

`db:media:mirror --apply` ahora también descarga las 134 imágenes de ejercicios
(hoy desde `raw.githubusercontent.com`) al almacenamiento local y repunta su `url`
a nuestro origen, guardando `checksum_sha256` y `mime_type` y conservando el
origen en `metadata.mirroredFrom`.

- Requirió una migración (`202608130001-local-exercise-media-url`) que relaja
  `ck_exercise_media_https` para permitir URLs http de **loopback** (self-hosted),
  manteniendo https obligatorio para cualquier host real.
- El importador del dataset se **desactiva** (`EXERCISES_DATASET_ENABLED=false`)
  para que un refresco no vuelva a apuntar las imágenes a GitHub. Alineado con "no
  llamar directamente del repo".
- Verificado en Docker: `exerciseMedia mirrored=134, failed=0`; DB `LOCAL=134`;
  imágenes servidas `200 image/jpeg` desde `/media/<sha256>.jpg`; dedup por
  contenido (135 archivos = 132 imágenes únicas + 3 portadas).

**Caveat de reproducibilidad (base vacía):** con el importador desactivado, una DB
recién creada no tendrá catálogo que espejar. Para regenerar desde cero:
`EXERCISES_DATASET_ENABLED=true` → arrancar (importa) → `yarn db:media:mirror
--apply` → volver a `false`. La solución definitiva (que el importador escriba
directo al storage local) queda como trabajo futuro.

## Docker

- **Volumen persistente** `media-data` montado en el servicio `api` en
  `/app/storage/media`. Es la única ruta escribible bajo el root de solo lectura
  (`read_only: true`); el resto del contenedor permanece inmutable.
- El punto de montaje se crea **propiedad de `node`** en la etapa runtime del
  `Dockerfile`, de modo que el volumen recién creado hereda esa propiedad y el
  proceso (uid 1000) puede escribir sin relajar la seguridad.
- Variables en `docker-compose.yml` (`x-app-environment`): `MEDIA_STORAGE_PROVIDER=local`,
  `MEDIA_STORAGE_LOCAL_ROOT=/app/storage/media`,
  `MEDIA_STORAGE_PUBLIC_BASE_URL=http://localhost:3001/media` (Docker publica la API en :3001).
- **Multi-host:** el disco local no se comparte entre hosts. Para escalar en varios
  hosts, usar un proveedor remoto (Cloudinary/S3) — el puerto ya lo permite sin
  cambiar el resto del código.

## Notas para el frontend

- La URL pública ya llega en `archivo.url` (regla `storage_url ?? source_url`): **sin
  cambio de contrato** cuando en el futuro se cambie de proveedor local a Cloudinary/S3 —
  solo cambia el host de la URL.
- El binario local se sirve estáticamente bajo `MEDIA_STORAGE_PUBLIC_BASE_URL` (solo con
  `MEDIA_STORAGE_PROVIDER=local`). En producción con un proveedor remoto, ese servido
  estático no se monta.
- No se expone ningún secreto de proveedor al frontend.
