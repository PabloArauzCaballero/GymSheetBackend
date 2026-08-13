# Evaluación — almacenamiento de media (Cloudinary u otro proveedor)

> Estado: **evaluación para [ADR-0007](../decisions/ADR-0007-pluggable-media-storage.md)**.
> **BLOCKED**: requiere decisión de dependencia (ADR, regla 70) y credenciales que no existen.

## Situación actual (evidencia)

- **Cero referencias a Cloudinary** en `src/`. No hay campo `secure_url`, ni SDK, ni upload.
- Dos modelos de media, ambos **solo almacenan URLs**, sin subir binarios a ningún proveedor:
  - [`MediaFileModel`](../../src/modules/membership/media-file.model.ts) (`media.files`): tiene
    `sourceUrl` (URL externa, hoy Unsplash), `storageUrl` **nullable** (hoy siempre `null`),
    `publicId` (UUID) ya presente, `license`, `attribution`. **No** tiene columna `provider`.
  - `ExerciseMediaModel` (`training.exercise_media`): enum `provider` con hoy solo `EXTERNAL_URL`,
    más `url`/`thumbnailUrl`/`checksumSha256`.
- El read path ya está preparado: `membership.mapper.ts:30` devuelve `storageUrl ?? sourceUrl`. Es
  decir, **el día que `storageUrl` se popule, el frontend recibe la URL del proveedor sin cambios de
  contrato**.

## Punto de anclaje limpio

`MediaFileModel.storageUrl` + `publicId` son el *slot* diseñado para un proveedor de almacenamiento.
Una integración Cloudinary poblaría `storage_url` (=`secure_url`) y reutilizaría `public_id`. Para
media de ejercicios, el anclaje es `ExerciseMediaModel.provider` (añadir un valor `CLOUDINARY`) +
`checksumSha256` (para idempotencia por contenido).

## Por qué está bloqueado (no se implementa a ciegas)

1. **Dependencia nueva** (`cloudinary` SDK) → la regla
   [70-library-selection](../../.claude/rules/70-library-selection.md) prohíbe añadirla sin ADR.
2. **Credenciales inexistentes** (`CLOUDINARY_CLOUD_NAME/API_KEY/API_SECRET`): sin ellas no hay
   upload real ni prueba de idempotencia; declarar "migrado a Cloudinary" sin ejecución violaría la
   regla de evidencia de `CLAUDE.md`.
3. **Licencia de media**: el repo ya distingue media por licencia
   (`EXERCISES_DATASET_MEDIA_LICENSE_CONFIRMED`, Unsplash con `attribution`). Subir imágenes de
   terceros a un CDN propio es una decisión legal, no técnica.

## Diseño propuesto (para el ADR, no implementado)

- Interfaz `MediaStorageProvider` con `upload(source): { provider, publicId, secureUrl, bytes,
  width, height, checksum }` e implementaciones `NoopProvider` (default, comportamiento actual) y
  `CloudinaryProvider` (tras aprobación).
- Upload **idempotente** por identidad determinista (`entidad + clave estable + rol de asset` y/o
  checksum), fuera de transacciones DB largas (patrón de la skill §12.6): resolver/subir → validar →
  persistir referencia en tx corta.
- Variables de entorno documentadas en `.env.example` **solo con nombres/ejemplos no secretos**.

## Alternativa sin lock-in

Si el objetivo es "controlar las imágenes" sin atarse a Cloudinary, la misma interfaz admite un
`S3Provider`/compatible. El ADR-0007 debe decidir el proveedor comparando lock-in, costo y licencia.
