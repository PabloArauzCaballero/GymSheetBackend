# ADR-0010 — MinIO como almacén de media inmutable, ordenado por usuario

Estado: **aceptado**
Fecha: 2026-09-13
Cierra los inputs pendientes de [ADR-0007](./ADR-0007-pluggable-media-storage.md)
("proveedor elegido (Cloudinary vs S3-compatible)").
Plan de ejecución: [`docs/plan/PLAN-MINIO-MEDIA.md`](../plan/PLAN-MINIO-MEDIA.md).

## Contexto

ADR-0007 dejó montada la arquitectura de puertos y adaptadores con un único
adaptador real (disco local) y dos casos que lanzaban error explícito
(`cloudinary`, `s3`), a la espera de que el propietario eligiera proveedor y
entregara credenciales.

El requisito de producto que desbloquea la decisión es, literalmente: las
imágenes subidas **nunca se borran**, y quedan **ordenadas por perfil de
usuario** en carpetas por categoría (publicaciones, stories, perfiles —público—
y las compartidas en cualquier chat).

Contexto operativo: el VPS ya ejecuta tres instancias de MinIO para otros
productos del mismo propietario, con el mismo patrón de despliegue (Coolify +
volumen nombrado + healthcheck `mc ready local`). No es tecnología nueva en la
casa.

## Decisión

### 1. Proveedor: MinIO (S3-compatible), auto-hospedado

Frente a Cloudinary: sin costo por volumen, sin salida de los binarios del VPS,
y el propietario ya lo opera. Frente a S3 de AWS: sin factura recurrente y sin
dependencia de un proveedor externo para un producto que hoy vive entero en un
único VPS. La compatibilidad S3 conserva la salida hacia AWS si algún día el
volumen lo justifica.

### 2. Librería: `minio` 8.0.7

| Alternativa | Versión | Licencia | Deps transitivas | Compatibilidad | Mantenimiento | Lock-in / salida |
|---|---|---|---|---|---|---|
| **`minio`** (elegida) | 8.0.7 | Apache-2.0 | 13 | Node 20+, sin peer de Nest | SDK oficial de MinIO, releases activas | Bajo: confinada a un fichero de adaptador detrás del puerto; además habla S3 genérico, así que sirve contra AWS S3 |
| `@aws-sdk/client-s3` | 3.1131.0 | Apache-2.0 | ~50 | Node 20+ | SDK oficial de AWS, muy activo | Igual de bajo, pero paga mucha más superficie (middleware stack, credential providers) para usar dos llamadas |

Solo se usan `statObject` y `putObject`. No hay duplicación de responsabilidad:
ninguna otra dependencia del `package.json` habla S3 (regla
[70-library-selection](../../.claude/rules/70-library-selection.md)).

### 3. Layout de claves: la carpeta es del usuario, no del contenido

```
users/{userId}/perfiles/{sha256}.{ext}          ← público
users/{userId}/stories/{sha256}.{ext}
users/{userId}/publicaciones/{sha256}.{ext}     ← prefijo reservado, sin módulo aún
users/{userId}/chats/{conversationId}/{sha256}.{ext}
catalog/{sha256}.{ext}                          ← mediateca admin y dataset espejado
```

El destino viaja como unión discriminada (`MediaUploadTarget`) para que el
compilador exija el `ownerUserId` de las carpetas de usuario y el
`conversationId` de los adjuntos de chat. El prefijo lo calcula
`mediaTargetPrefix` **en el puerto**, no en cada adaptador: el layout es una
decisión de producto, y local y MinIO deben producir la misma estructura para
que desarrollo y producción se parezcan.

**Consecuencia aceptada**: la deduplicación por SHA-256 deja de cruzar usuarios.
Dos socios que suben la misma foto ocupan dos objetos. Es el precio de que la
carpeta sea del usuario, y a cambio desaparece la clase de fallo que obligó a
escribir `MediaReferencesRepository`: borrar lo de uno ya no puede romper lo de
otro. El refcount se conserva igual (sigue siendo correcto, y `media.files` y
`training.exercise_media` comparten `catalog/`).

### 4. Inmutabilidad en tres capas

1. **Credenciales**: el usuario MinIO de la API tiene `s3:PutObject` y
   `s3:GetObject`, **no** `s3:DeleteObject`. Aunque un bug llame a borrar, el
   servidor lo rechaza.
2. **Versionado del bucket**: una sobrescritura nunca destruye la versión previa.
3. **Adaptador**: `remove()` es un no-op deliberado y el puerto lo declara con
   `readonly immutable: boolean`.

`immutable` está en el puerto y no escondido dentro del adaptador porque cambia
lo que `MediaRetentionService` puede prometer: con un proveedor inmutable la
fila se borra igual (la story caduca, la foto sale de la galería) pero el objeto
sobrevive, y el servicio tiene que decirlo en su log y en su resultado en vez de
anunciar un borrado que no ocurrió.

### 5. Visibilidad

`users/*/perfiles/*` es de **lectura anónima** por política de bucket: el
directorio del gimnasio y los perfiles públicos los consumen navegadores sin
sesión contra el almacén. El resto de prefijos hereda el modelo de seguridad que
ya tenía el adaptador local (URLs no adivinables, derivadas del SHA-256 del
contenido); endurecerlos con URLs prefirmadas queda como fase posterior del plan,
no como parte de esta decisión.

Cada objeto se escribe con el `Content-Type` **validado** (nunca derivado del
nombre que manda el cliente) y con `Content-Disposition: attachment`, igual que
el montaje estático de `main.ts`: misma contención para los mismos bytes ajenos.

## Consecuencias

- (+) Cumple el requisito literal de retención permanente, con la garantía en el
  servidor y no solo en el código.
- (+) Las imágenes dejan de vivir en el volumen del contenedor de la API.
- (−) El disco solo crece. El respaldo y la vigilancia de espacio pasan a ser
  parte del plan operativo, no un extra.
- (−) El derecho de supresión (RGPD) deja de ser automatizable: borrar datos de
  un usuario exige intervención manual con credenciales root de MinIO. Es
  deliberado y queda documentado aquí para que la próxima persona no lo
  descubra durante una solicitud real.
