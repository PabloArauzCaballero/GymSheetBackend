# Plan — Vídeos de demostración por ejercicio (hombre y mujer)

Fecha: 2026-09-16 · Rama base: `dev` · Estado: **decidido y en ejecución** (ver §12)

Objetivo del documento: decidir **cómo se producen** 2.648 demostraciones (1.324 ejercicios ×
2 variantes) con la máxima calidad alcanzable, y dejar cerrada la parte técnica —formato,
nombres, carga y control de calidad— para que producir sea lo único que quede abierto.

Relacionado: [PLAN-MINIO-MEDIA.md](PLAN-MINIO-MEDIA.md) (almacén ya en marcha) y
[ADR-0010](../decisions/ADR-0010-minio-immutable-media.md) (los objetos no se borran nunca).

## 0. Lo que ya está resuelto en el repo

Verificado leyendo el código, no supuesto:

| Pieza | Estado |
|---|---|
| `training.exercise_media` | Admite `IMAGE`, `GIF` y `VIDEO`; guarda `url`, `thumbnailUrl`, `mimeType`, `width`, `height`, `checksumSha256`, `altText`, `attribution`, `license`, `isPrimary`, `sortOrder`, `status`, `metadata` (JSONB) |
| Alta de media | `POST /exercises/:id/media` (`createExerciseMediaSchema`), máximo **10 medios activos por ejercicio** (`exercise-media.service.ts`) |
| Orden de lectura | `isPrimary DESC, sortOrder ASC, createdAt ASC` (`exercise-media.repository.ts`) |
| Almacén | MinIO real en el VPS, bucket `gymsheet-media` versionado, listado anónimo denegado |
| Carpeta por ejercicio | `mediaTargetPrefix()` ya soporta `{ category: "ejercicios", exerciseId }` → clave `ejercicios/<exerciseId>/<sha256>.<ext>` |
| Catálogo | 1.324 ejercicios sembrados al arranque, con `target_muscle`, `secondary_muscles`, `body_part`, `category`, `required_equipment` e `instruction_steps.es` (4–11 pasos, media 5,8) |

Esos campos del catálogo son el guion: no hay que escribir de cero qué músculo resaltar ni
qué movimiento representar.

## 1. Objetivo y criterios de aceptación

Un vídeo es aceptable cuando cumple **todo** lo siguiente. Cualquier fallo es rechazo, no
observación.

1. **Técnica correcta**: postura inicial, agarre, recorrido articular y posición final
   coinciden con `instruction_steps.es` del propio ejercicio.
2. **Ángulo legible**: el plano muestra la articulación que trabaja. Tres cuartos frontal
   por defecto; lateral cuando el movimiento es sagital (sentadilla, peso muerto, press
   de banca).
3. **Repeticiones**: exactamente **2 repeticiones completas** y vuelta a la posición
   inicial, para que el bucle no invente una tercera a medias.
4. **Bucle limpio**: primer y último fotograma idénticos en posición y en iluminación.
5. **Músculos resaltados**: el agonista (`target_muscle`) en color primario y los
   secundarios (`secondary_muscles`) en un tono atenuado, con la misma paleta en todos.
6. **Dos variantes**: cuerpo masculino y femenino, mismo movimiento, mismo plano, misma
   duración. No es el mismo modelo recoloreado: proporciones y ejecución distintas.
7. **Equipo reconocible, no protagonista**: decisión del propietario (2026-09-16). Lo que
   se evalúa es el **cuerpo y el movimiento**; la máquina puede ir esbozada —silueta simple,
   sin logotipos ni detalle de fabricante— siempre que se entienda qué sujeta y dónde apoya
   quien entrena. Un banco, una polea o una barra mal dibujados no son motivo de rechazo; un
   agarre o un recorrido mal representados, sí. Esto abarata el modelado y concentra el
   esfuerzo donde está el valor: la ejecución.
8. **Sin audio, sin texto quemado, sin marca de agua.** El texto va en la interfaz, que es
   traducible; quemarlo en el vídeo lo congela en un idioma.

Cómo se revisa: §7.

## 2. Opciones de producción, comparadas

Los costes en dinero son **rangos sin verificar**: no he consultado tarifas hoy y las de
licencias dependen de negociación. Las horas sí están calculadas, y el método está a la
vista en §9 para poder discutirlo.

### (a) 3D propio — Blender

Personaje riggeado (MakeHuman/Mixamo para la base, Rigify para el control), capa muscular
como máscara de textura sobre el cuerpo, iluminación y cámara fijas por plantilla.

- **Calidad alcanzable**: alta y, sobre todo, **uniforme**. Es la única opción que da
  resaltado muscular real, no un dibujo encima.
- **Tiempo**: 80–120 h de montaje inicial, 120 h de biblioteca de patrones base, ~35 min
  por ejercicio de animación y ~10 min de variante. Total ≈ **1.370–1.470 h persona**.
- **Riesgo biomecánico**: medio y **controlable**: un error se corrige en la curva de
  animación y se re-renderiza.
- **Licencia**: propia. MakeHuman (CC0 para las mallas generadas) y Mixamo (uso permitido
  en producto, conviene releer sus términos antes de empezar) — **verificar por escrito**.
- **Mantenimiento**: barato. Un ejercicio nuevo reutiliza personaje, luces y patrón.

### (b) Captura de movimiento + render

Traje inercial (Rokoko, Xsens) sobre un atleta real, retargeting al personaje 3D de (a).

- **Calidad**: la más realista en el movimiento; hereda de (a) el resaltado muscular.
- **Tiempo**: 8–12 días de captura, 10–20 min de limpieza por clip (≈ 440–880 h) más el
  montaje de (a).
- **Riesgo**: deriva del pie y penetración con el equipo; cada clip necesita repaso.
- **Coste**: alquiler de traje + atleta + sala. **Sin verificar.**

### (c) Grabación con personas reales

Dos atletas, gimnasio propio, dos cámaras.

- **Calidad**: excelente en realismo. **No permite resaltar músculos** salvo añadiendo una
  ilustración 2D encima, que es otra producción entera (10–20 min por clip).
- **Tiempo**: ~14 días de rodaje a 100 ejercicios/día con ambos atletas, más 6–10 min de
  postproducción por clip (≈ 350 h). Con overlay anatómico, +440–880 h.
- **Riesgo**: alto en consistencia. Ropa, luz, encuadre y fatiga del atleta cambian entre
  jornadas, y el catálogo queda desigual.
- **Licencia**: hay que firmar cesión de imagen de cada atleta.

### (d) Generación por IA

Honestamente: **hoy no sirve para esto.** Los generadores de vídeo actuales fallan justo en
lo que aquí se evalúa:

- No mantienen **el mismo personaje** a lo largo de 2.648 clips.
- No respetan un **número exacto de repeticiones**; alargan o cortan el movimiento.
- Deforman **manos y agarre**, que es donde mira quien aprende un ejercicio.
- El **equipo se transforma** a mitad de clip (una barra se vuelve mancuerna).
- No hay control sobre **qué músculo se resalta**: no entienden anatomía, la imitan.

Usos donde sí encaja: fondos, tratamiento de color del póster, o bocetos de encuadre para
el equipo de animación. Nada que el socio vaya a ver como referencia técnica.

### (e) Licenciar una librería existente

Proveedores a consultar: GymVisual, ExerciseDB, Everkinetic. El catálogo actual ya viene de
`free-exercise-db`, y sus **imágenes** son de dominio público (`Unlicense`, atribución ya
registrada en el importador).

- **Calidad**: buena y homogénea. Normalmente **sin variante femenina** y **sin resaltado
  muscular** configurable.
- **Tiempo**: días, no meses. Es la vía rápida.
- **Coste**: **sin verificar**; pedir presupuesto.
- **Riesgo**: contractual. Hay que confirmar por escrito que la licencia permite
  **auto-hospedar** los binarios en MinIO y redistribuirlos dentro de la app.

### Resumen

| Opción | Resaltado muscular | Dos variantes | Horas persona | Riesgo técnica | Licencia |
|---|---|---|---|---|---|
| (a) 3D propio | Sí, nativo | Sí | 1.370–1.470 | Medio, corregible | Propia |
| (b) Mocap + render | Sí, nativo | Sí | +440–880 sobre (a) | Medio | Propia |
| (c) Grabación real | Solo con overlay | Sí | 350 (+440–880) | Alto en consistencia | Cesión de imagen |
| (d) IA | No | No | — | **Inaceptable** | Dudosa |
| (e) Licencia | Normalmente no | Normalmente no | ~40 | Bajo | De terceros |

## 3. Recomendación

**Parche inmediato (días), en paralelo a todo lo demás:** activar la importación de las
imágenes libres que ya trae el catálogo (`EXERCISES_DATASET_IMPORT_MEDIA`, hoy en `false`)
y espejarlas a MinIO con `yarn db:media:mirror --apply`. Da una lámina por ejercicio, de
dominio público, sin producir nada. No cumple los criterios de §1, y no pretende hacerlo:
evita la pantalla vacía mientras se decide.

**Producción: opción (a), 3D propio, por fases.**

| Fase | Alcance | Entrega |
|---|---|---|
| V0 | Montaje: 2 personajes, shader de resaltado, plantilla de escena, pipeline ffmpeg y de carga | Un ejercicio completo de extremo a extremo, visible en la app |
| V1 | **Piloto de 20 ejercicios** (§3.1) | 80 piezas (20 × 2 variantes × 2 formatos), revisadas y firmadas |
| V2 | 200 ejercicios más frecuentes | Cubre la mayoría de las sesiones reales |
| V3 | Cola larga hasta 1.324 | Catálogo completo |

La decisión de seguir a V2 se toma **viendo V1 en el móvil**, no en una hoja de cálculo. Si
el piloto no convence, se ha gastado el 1,5 % del esfuerzo total.

### 3.1 Los 20 del piloto

Resueltos contra el catálogo real el 2026-09-16 (nombres exactos, en inglés, como están
sembrados). Elegidos por cobertura de patrón y de equipo, no por gusto: empuje horizontal y
vertical, tracción horizontal y vertical, bisagra de cadera, sentadilla, zancada, aislados de
brazo y hombro, gemelo y dos de core.

| # | Nombre en el catálogo | Equipo | Músculo objetivo |
|---|---|---|---|
| 1 | barbell full squat | barbell | glutes |
| 2 | barbell deadlift | barbell | glutes |
| 3 | barbell bench press | barbell | pectorals |
| 4 | barbell seated overhead press | barbell | delts |
| 5 | barbell bent over row | barbell | upper back |
| 6 | pull-up | body weight | lats |
| 7 | push-up | body weight | pectorals |
| 8 | ring dips | body weight | triceps |
| 9 | dumbbell lunge | dumbbell | glutes |
| 10 | barbell glute bridge | barbell | glutes |
| 11 | sled 45 degrees one leg press | sled machine | glutes |
| 12 | dumbbell biceps curl | dumbbell | biceps |
| 13 | cable triceps pushdown (v-bar) | cable | triceps |
| 14 | cable pulldown | cable | lats |
| 15 | dumbbell lateral raise | dumbbell | delts |
| 16 | cable rear delt row (stirrups) | cable | delts |
| 17 | barbell romanian deadlift | barbell | glutes |
| 18 | dumbbell standing calf raise | dumbbell | calves |
| 19 | weighted front plank | weighted | abs |
| 20 | russian twist | body weight | abs |

Tres sustituciones respecto al borrador, porque esos nombres no existen en el catálogo:
press militar de pie → `barbell seated overhead press`; hip thrust → `barbell glute bridge`
(mismo patrón de extensión de cadera); face pull → `cable rear delt row (stirrups)`.

Para obtener los identificadores en el entorno donde se vaya a cargar:

```sql
SELECT id, nombre, required_equipment, target_muscle
  FROM ejercicios
 WHERE data_source <> 'CUSTOM' AND estado = 'ACTIVO'
   AND lower(nombre) IN (
     'barbell full squat','barbell deadlift','barbell bench press',
     'barbell seated overhead press','barbell bent over row','pull-up','push-up','ring dips',
     'dumbbell lunge','barbell glute bridge','sled 45 degrees one leg press',
     'dumbbell biceps curl','cable triceps pushdown (v-bar)','cable pulldown',
     'dumbbell lateral raise','cable rear delt row (stirrups)','barbell romanian deadlift',
     'dumbbell standing calf raise','weighted front plank','russian twist')
 ORDER BY nombre;
```

## 4. Especificación técnica del asset

**Vídeo, no GIF.** Un GIF de 6 s a 1080×1080 pesa entre 8 y 15 MB, usa paleta de 256
colores —el degradado del resaltado muscular se corta en bandas— y no se puede pausar. El
modelo ya admite `VIDEO`.

| Parámetro | Valor |
|---|---|
| Relación y resolución | 1:1, **1080×1080** (encaja en tarjeta y en detalle sin recorte) |
| Fotogramas | 30 fps |
| Duración | 6 s, 2 repeticiones, bucle perfecto |
| Formato principal | MP4 H.264 High, CRF 23, `yuv420p`, `+faststart` |
| Formato alternativo | WebM AV1, CRF 35 |
| Póster | WebP 1080×1080, calidad 82, tomado en la contracción máxima |
| Audio | Ninguno (`-an`) |
| Máster | 1440×1440 sin comprimir o ProRes, **fuera de MinIO** (ver §4.2) |

### 4.1 Comandos exactos

> **Ojo:** en este Mac ffmpeg 9.0.1 está instalado pero **hoy no arranca**: falta
> `libx265.216.dylib`. Se arregla con `brew reinstall ffmpeg`. Verificado el 2026-09-16.

```bash
# MP4 H.264 (principal)
ffmpeg -i master.mov \
  -vf "scale=1080:1080:flags=lanczos,fps=30" \
  -c:v libx264 -profile:v high -level 4.0 -preset slow -crf 23 \
  -pix_fmt yuv420p -g 60 -keyint_min 60 -movflags +faststart -an \
  ejercicio-hombre.mp4

# WebM AV1 (alternativo; si falta libsvtav1, usar -c:v libvpx-vp9 -crf 32 -b:v 0)
ffmpeg -i master.mov \
  -vf "scale=1080:1080:flags=lanczos,fps=30" \
  -c:v libsvtav1 -crf 35 -preset 6 -pix_fmt yuv420p -an \
  ejercicio-hombre.webm

# Póster en el segundo 2,4 (contracción máxima de la primera repetición)
ffmpeg -ss 2.4 -i ejercicio-hombre.mp4 -frames:v 1 \
  -vf "scale=1080:1080:flags=lanczos" -c:v libwebp -quality 82 \
  ejercicio-hombre-poster.webp

# Comprobación antes de subir: duración, dimensiones y número de fotogramas
ffprobe -v error -select_streams v:0 \
  -show_entries stream=width,height,r_frame_rate,nb_frames \
  -show_entries format=duration,size -of json ejercicio-hombre.mp4
```

### 4.2 Presupuesto de almacenamiento

Método a la vista, para poder rehacerlo con otros valores:

- MP4 ≈ 2,5 Mbit/s × 6 s = 15 Mbit ≈ **1,9 MB**
- WebM ≈ 1,2 Mbit/s × 6 s = 7,2 Mbit ≈ **0,9 MB**
- Póster ≈ **0,12 MB**
- Por variante ≈ 2,9 MB · por ejercicio (2 variantes) ≈ **5,8 MB**
- Catálogo completo: 1.324 × 5,8 MB ≈ **7,7 GB**
- Margen por re-renderizados (25 % de las piezas, una vez) ≈ +1,9 GB → **presupuestar 10 GB**

Los **másteres no van a MinIO**: a ProRes 422 LT serían ~45 MB por pieza, 119 GB en total, y
el disco del VPS no los aguanta. Van a un disco externo con copia, fuera de este sistema.

Disco del VPS medido el 2026-09-16: 233 GB totales, 173 GB usados, **49 GB libres (79 %)**.
Los 10 GB entran, pero son la quinta parte de lo libre, y **B4 del plan de MinIO —respaldo y
alerta de disco— sigue pendiente**. Con inmutabilidad y versionado, el almacén solo crece.

### 4.3 Presupuesto de ancho de banda

- Una apertura de detalle con reproducción = 1,9 MB.
- 100 socios × 12 aperturas/día ≈ 2,3 GB/día ≈ **68 GB/mes**.
- Mitigación obligatoria en la app: en los listados solo el **póster** (0,12 MB), `preload="none"`,
  y el vídeo únicamente en la ficha del ejercicio.

## 5. Nombres y metadatos

Clave en MinIO, ya soportada por el puerto:

```
ejercicios/<exerciseId>/<sha256>.mp4
ejercicios/<exerciseId>/<sha256>.webm
ejercicios/<exerciseId>/<sha256>.webp     ← póster
```

El nombre es el SHA-256 del contenido, así que **la variante no se distingue por el nombre
del archivo** sino por la fila en base de datos. Eso es deliberado: el mismo binario subido
dos veces no se duplica.

**Cuatro filas por ejercicio**, no seis: el póster no ocupa fila propia, va en
`thumbnailUrl` de su vídeo. Con el límite de 10 medios activos quedan 6 huecos libres.

| Fila | `mediaType` | `metadata.variant` | `sortOrder` | `isPrimary` |
|---|---|---|---|---|
| MP4 hombre | `VIDEO` | `hombre` | 0 | **sí** |
| WebM hombre | `VIDEO` | `hombre` | 1 | no |
| MP4 mujer | `VIDEO` | `mujer` | 10 | no |
| WebM mujer | `VIDEO` | `mujer` | 11 | no |

```json
{
  "variant": "hombre",
  "renderVersion": 1,
  "loop": true,
  "durationMs": 6000,
  "reps": 2,
  "highlight": { "target": "abs", "secondary": ["obliques", "lower back"] },
  "reviewedBy": "<nombre del revisor>",
  "reviewedAt": "2026-10-01",
  "masterChecksum": "<sha256 del máster>"
}
```

- `externalId`: `gymsheet:<exerciseId>:<variant>:<formato>:v<renderVersion>` — es la clave
  natural para no crear filas duplicadas al reintentar una carga.
- `altText` (obligatorio, ≤ 500): «Demostración de {nombre} con {equipo}, versión
  {variante}. Trabaja {target_muscle}.»
- `license` y `attribution` **obligatorios aunque el contenido sea propio**:
  `license: "Propiedad de GymSheet"`, `attribution: "<estudio o autor>"`.
- La app elige variante por `metadata.variant` contra el género del perfil, y cae al
  `isPrimary` cuando no hay coincidencia o el perfil no lo declara.

## 6. Proceso de carga

1. Producción deja los archivos en `entregas/<exerciseId>/{hombre,mujer}.{mp4,webm,webp}`.
2. Se sube cada pieza por el endpoint multipart de subida de media de ejercicio, que guarda
   bajo `ejercicios/<exerciseId>/` y crea la fila.
3. **Idempotencia en dos capas**: la clave es el SHA-256 del contenido, así que repetir la
   subida reutiliza el objeto (`reused: true`); y el `externalId` evita la fila duplicada.
4. **Reemplazar una versión**: subir el archivo nuevo (clave nueva), poner la fila anterior
   en `status: INACTIVE` y crear la nueva con `renderVersion + 1`. **Nunca se edita la `url`
   de una fila existente**: se perdería el rastro de qué vio el socio. El objeto viejo
   permanece en MinIO para siempre (ADR-0010); es el coste que ya se aceptó.
5. `isPrimary` se recalcula al final de cada ejercicio, no por pieza suelta.

## 7. Control de calidad

Cada pieza pasa una revisión con esta lista. **Firma un entrenador con titulación**, no el
equipo de producción, y su nombre queda en `metadata.reviewedBy`.

- [ ] Posición inicial y final coinciden con `instruction_steps.es`
- [ ] Agarre y anchura de manos correctos
- [ ] Recorrido completo, sin acortar el rango
- [ ] Columna neutra donde corresponde; sin valgo de rodilla no intencionado
- [ ] Rodilla y codo siguen la trayectoria correcta
- [ ] Tempo estable, 2 repeticiones exactas
- [ ] Bucle sin salto en el primer fotograma
- [ ] Resaltado coincide con `target_muscle` y `secondary_muscles`
- [ ] Equipo mostrado = `required_equipment`
- [ ] Lado dominante correcto en ejercicios unilaterales

Rechazo: vuelve a animación con el punto exacto de la lista; se re-renderiza y sube como
`renderVersion + 1`. Se registra qué se rechazó y por qué, para no repetir el mismo fallo en
la cola larga.

## 8. Riesgos y límites

- **Enseñar mal una técnica.** Es el riesgo grave. Un peso muerto mal representado puede
  lesionar a quien lo copia. Por eso la revisión la firma alguien con titulación y por eso
  (d) queda descartada.
- **Coste y plazo reales.** 1.370–1.470 h no es un proyecto de una tarde; a una persona a
  tiempo completo son 8–9 meses. Decidir con ese número delante, no con el entusiasmo del
  piloto.
- **Crecimiento del almacén.** Inmutable y versionado: cada re-render suma para siempre. Sin
  la fase B4 del plan de MinIO (respaldo y alerta de disco), un descuido llena el disco del
  VPS y se lleva por delante todo lo demás.
- **Licencias de terceros.** Si se elige (e), confirmar por escrito el auto-hospedaje. Si se
  elige (a) con bases de Mixamo/MakeHuman, releer sus términos antes de la primera hora de
  trabajo.
- **Accesibilidad.** El vídeo sin `altText` útil deja fuera a quien usa lector de pantalla;
  el campo es obligatorio en el esquema, pero un texto vacío de contenido lo cumple sin
  servir. La descripción textual del ejercicio sigue siendo la fuente accesible principal.
- **Ancho de banda del VPS.** 68 GB/mes estimados con 100 socios; el Funnel de Tailscale no
  es una CDN. Si el uso crece, toca CDN delante de MinIO.

## 9. Estimaciones, con el método a la vista

Horas persona, opción (a):

| Concepto | Cálculo | Horas |
|---|---|---|
| Montaje inicial | Personajes + shader + escena + pipeline | 80–120 |
| Biblioteca de patrones | ~40 patrones × 3 h | 120 |
| Animación por ejercicio | 1.324 × 35 min | ~770 |
| Variante femenina | 1.324 × 10 min | ~220 |
| Revisión biomecánica | 2.648 × 4 min | ~177 |
| Carga y verificación | Automatizada | 8–16 |
| **Total** | | **1.375–1.423** |

Render: 2.648 piezas × 6 s × 30 fps = **476.640 fotogramas**. A 2 s/fotograma con GPU son
~265 h de máquina, paralelizables y sin ocupar a nadie. En CPU se va a más de 2.600 h, que
es el argumento para alquilar GPU o granja.

Por fases: V0 ≈ 200–240 h · V1 (20 ejercicios) ≈ 25 h · V2 (200) ≈ 190 h · V3 (resto) ≈ 950 h.

Coste en dinero: **no lo estimo aquí**. Depende de la tarifa del animador y de si se alquila
render. Con las horas de arriba y una tarifa cerrada, el cálculo es inmediato.

## 10. Bloqueos técnicos que hay que resolver antes de la primera carga

Los tres primeros son de código o configuración, y **hoy impedirían subir un vídeo**:

1. **HTTPS obligatorio, y no solo en el esquema — también en la base.** Verificado contra el
   entorno de test el 2026-09-16 subiendo un archivo real: existe
   `ck_exercise_media_https CHECK (url ~ '^https://' OR url ~ '^http://localhost(:[0-9]+)?/'
   OR url ~ '^http://127\.0\.0\.1(:[0-9]+)?/')`. El MinIO de test se publica como
   `http://gym-media.161.97.85.216.sslip.io/gymsheet-media`, así que la carga **guarda el
   objeto en MinIO y luego falla al insertar la fila**, dejando un huérfano en un almacén que
   nunca borra (ADR-0010). Lo que sí quedó demostrado es el resto de la cadena: el objeto
   aterrizó en `ejercicios/<exerciseId>/<sha256>.gif` del bucket `gymsheet-media`.
   Arreglo real: **TLS delante del host de media** (o publicar el bucket por un dominio con
   certificado). No relajar la restricción. Mientras tanto, el código comprueba la URL antes
   de subir y falla con un mensaje accionable en vez de un 500 opaco.
2. ~~`MEDIA_ALLOWED_MIME` no admite vídeo.~~ **Resuelto** (da4c4e9): `EXERCISE_MEDIA_ALLOWED_MIME`
   incluye `video/mp4` y `video/webm`, con su extensión en el mapa cerrado de MIME.
3. ~~`MEDIA_UPLOAD_MAX_BYTES` por defecto son 5 MB.~~ **Resuelto** (da4c4e9):
   `EXERCISE_MEDIA_MAX_BYTES` = 50 MB por defecto, propio del media de ejercicio.
4. **B4 del plan de MinIO** (respaldo y alerta de disco) debería estar hecho antes de V2, no
   después.

## 11. Las tres decisiones que necesito del propietario

1. **Origen del contenido**: ¿3D propio (recomendado), mocap, grabación real, o licenciar?
   Todo lo demás depende de esta.
2. **Presupuesto y quién produce**: ¿equipo interno, freelance o estudio? Con una tarifa por
   hora, las estimaciones de §9 se convierten en cifra.
3. **Alcance**: ¿los 1.324 ejercicios, o los 200 más usados y la cola larga después? Mi
   recomendación es la segunda, midiendo el uso real antes de gastar 950 h en la cola.


## 12. Decisiones tomadas y estado de ejecución

Decisiones del propietario (2026-09-16), por la recomendación de este plan:

1. **Origen del contenido: 3D propio (opción a).** Descartadas la IA por riesgo biomecánico y
   la licencia de terceros por no traer variante femenina ni resaltado muscular.
2. **Alcance: por fases.** Piloto de 20 (§3.1), después los 200 más usados, y la cola larga
   solo si el piloto convence al verlo en el móvil.
3. **Presupuesto y quién produce: pendiente.** Es la única decisión que no se puede cerrar sin
   una tarifa por hora; las horas de §9 ya están calculadas.
4. **Foco del asset: el movimiento.** El equipo va esbozado (§1.7).

Estado de la parte que no necesita producción:

| Pieza | Estado |
|---|---|
| Carpeta por ejercicio en MinIO y subida multiparte | Hecho y desplegado en `dev` y `test` (da4c4e9 / eb16170) |
| Variante hombre/mujer en los metadatos | Hecho |
| Reintento idempotente de la carga | Hecho |
| Póster en `thumbnailUrl`, `externalId` canónico, comando de carga por lotes, validación con ffprobe | En curso |
| Reproducción en la app: variante por perfil, póster en listas, vídeo solo en la ficha | En curso |
| TLS delante del MinIO de test | **Bloqueado**: es infraestructura del servidor de Contabo |
| Producción de los 2.648 vídeos | **No la puede hacer una máquina.** Requiere animador 3D y revisión firmada por entrenador titulado |
