# ADR-0007 — Almacenamiento de media pluggable (puertos y adaptadores)

Estado: **aceptado** (implementado con adaptador local Multer; Cloudinary/S3 pendientes de credenciales)  
Fecha: 2026-08-07 · **Actualizado:** 2026-08-12  
Origen: skill externa `github-canonical-data-reform`, fase 8. Evaluación en
[`docs/data-reform/media-storage-assessment.md`](../data-reform/media-storage-assessment.md).

## Decisión efectiva (2026-08-12)

Por instrucción del propietario ("crea una infraestructura poligonal para soportar cualquier
proveedor y un adaptador para Multer") se implementó una **arquitectura de puertos y adaptadores**:

- Puerto `MediaStorageProvider` ([`src/modules/media/media-storage.port.ts`](../../src/modules/media/media-storage.port.ts)).
- Adaptador **local vía Multer** ([`adapters/local-storage.adapter.ts`](../../src/modules/media/adapters/local-storage.adapter.ts)):
  el `FileInterceptor` (memoryStorage, dependencia transitiva de `@nestjs/platform-express`, **sin
  añadir librerías**) entrega el buffer y el adaptador lo persiste en disco, **idempotente por
  SHA-256** del contenido.
- Factory con selección por `MEDIA_STORAGE_PROVIDER` **sin fallback silencioso**: `cloudinary`/`s3`
  lanzan error explícito hasta que se implemente su adaptador.
- Persistencia en `media.files` reutilizando columnas existentes (`source_type='MANAGED'`,
  `source_name=<provider>`, `storage_url`, `public_id`) — **sin migración ni reforma de esquema**.
- Servido estático del root local en `main.ts` (solo cuando `MEDIA_STORAGE_PROVIDER=local`).

Cuando el propietario entregue credenciales Cloudinary/S3, añadir un `CloudinaryAdapter`/`S3Adapter`
que cumpla el puerto y registrarlo en el factory es la única tarea restante; el resto (endpoint,
persistencia, contrato de frontend) ya no cambia.

## Contexto

La skill pide migrar las imágenes canónicas a **Cloudinary**. Evidencia:
- **Cero** integración de almacenamiento en `src/`; toda la media se guarda como **URL externa**
  (`MediaFileModel.sourceUrl`, Unsplash; `ExerciseMediaModel.provider = EXTERNAL_URL`).
- El *slot* de destino ya existe: `MediaFileModel.storageUrl` (nullable) + `publicId`, y el read path
  ya hace `storageUrl ?? sourceUrl` → poblar `storage_url` no rompe el contrato del frontend.

## Por qué requiere un ADR (no se implementa a ciegas)

- Añadir el SDK `cloudinary` es una **dependencia nueva** → regla
  [70-library-selection](../../.claude/rules/70-library-selection.md) exige este ADR.
- **No hay credenciales**; sin ellas no hay upload real ni prueba de idempotencia. Declarar la
  migración "hecha" sin ejecución violaría la regla de evidencia de `CLAUDE.md`.
- Subir imágenes de terceros a un CDN propio es una decisión **de licencia**, no técnica.

## Decisión propuesta

1. Interfaz `MediaStorageProvider.upload(source) → { provider, publicId, secureUrl, bytes, width,
   height, checksum }`, con `NoopProvider` (default = comportamiento actual) y `CloudinaryProvider`
   (o `S3Provider`, a decidir para evitar lock-in).
2. Upload **idempotente** por identidad determinista/checksum, fuera de transacciones DB largas
   (patrón skill §12.6). Persistir `storage_url`/`public_id` en tx corta.
3. Variables en `.env.example` **solo con nombres/ejemplos no secretos**:
   `MEDIA_STORAGE_PROVIDER`, `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`,
   `CLOUDINARY_FOLDER`. Secretos jamás versionados.

## Inputs requeridos para desbloquear

- [ ] Proveedor elegido (Cloudinary vs S3-compatible) y justificación de lock-in/costo/licencia.
- [ ] Credenciales en `.env` local/entorno (no en el repo).
- [ ] Confirmación de licencia de cada set de imágenes a migrar.

## Consecuencias

- (+) Control propio de assets; frontend sin cambio de contrato (fallback ya implementado).
- (−) Dependencia externa y costo operativo; riesgo de lock-in mitigado por la interfaz.
