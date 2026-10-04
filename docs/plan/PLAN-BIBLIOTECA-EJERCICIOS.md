# Plan — Biblioteca de demostraciones comprada (2026-10)

El propietario compró tres paquetes de animaciones de ejercicios. Este documento recoge cómo se
catalogan y se cargan en `public.ejercicios`, `training.exercise_media` y MinIO, y por qué.
Complementa a `PLAN-VIDEOS-EJERCICIOS.md` (renders propios), cuya §14 explica por qué los GIF del
dataset actual no se pueden usar.

## 1. El material, tal como llegó

| Paquete | Contenido | Uso |
|---|---|---|
| Entrenamiento funcional y HIIT | 206 GIF 1080×1080, ~6 s, 10 fps, nombres en portugués | Sí |
| Manual de estiramiento y movilidad | 135 GIF iguales en formato + un PDF | GIF sí. El PDF está truncado (solo portada e introducción, sin capa de texto) |
| Biblioteca 1000 GIFs 2 | 70 MP4 verticales 720×1280 (64 únicos) + 100 docx | Clips recortados de los MP4, sí. Los docx son rutinas traducidas a máquina: fuera de alcance |

Problemas encontrados y corregidos en la catalogación:

- Nombres en Unicode NFD: se normalizan a NFC antes de compararlos.
- Duplicados con otro nombre dentro de cada carpeta y entre carpetas, una imagen fija mal
  etiquetada, nombres que no describen lo que se ve («Elevação lateral de braços» son círculos de
  brazos), erratas («Corrida Latera», «Cópia de…», «Nave Seal») e inglés mezclado.
- 25 piezas de la carpeta de estiramientos no son estiramientos (manguito rotador con polea o
  mancuerna, activación con banda): se clasifican por lo que son.
- Cada MP4 es una recopilación de 5–10 ejercicios con barra de músculos arriba, rótulo en inglés
  abajo, música, logo «YOU CAN» y pantalla final de App Store. Muchos son vídeos de técnica
  (✓/✗), que se descartan.

## 2. Decisiones

1. **Licencia:** material comprado. `source_license = "Licencia comercial adquirida por GymSheet"`;
   la referencia de compra va en `source_attribution` cuando se tenga.
2. **Formato:** MP4 H.264 (CRF 23, `tune animation`, sin audio, `+faststart`) + póster WebP en
   `thumbnailUrl`. Los GIF de un fotograma se cargan como imagen WebP. No se sube ningún GIF.
3. **Recorte de los MP4:** un clip por ejercicio, cuadrado, sin barra de músculos ni rótulo, sin
   audio, intro ni pantalla final. Se quedan en 720×720 (no se reescalan a 1080).
4. **Marca residual:** «YOUCAN»/«DEMIC» impreso en pantalón, banco o esterilla no se quita
   recortando. Esas piezas llevan `metadata.brandingVisible = true` y nunca desplazan a una pieza
   limpia como principal; si son lo único que tiene el ejercicio, son su principal.
5. **Catálogo:** cada pieza se **enlaza** a un ejercicio existente (mismo movimiento y mismo
   equipo) o **crea** uno nuevo. Los enlaces de confianza media no se aplican sin revisión
   humana; mientras tanto se crean como nuevos.
6. **Idioma:** `nombre` en español; portugués e inglés en `metadata.names`.
7. **`data_source = CUSTOM`, no un origen nuevo.** El contrato del cliente valida `dataSource`
   con `z.enum(['CUSTOM', 'EXERCISES_DATASET'])`, y un valor desconocido hace fallar el listado
   ENTERO en todas las apps instaladas. CUSTOM además es lo que son —catálogo curado a mano— y
   les aplica la unicidad de nombre. La procedencia queda en `external_id = bib:<modalidad>:<slug>`,
   `metadata.library`, `source_license` y `source_attribution`.
8. **El vídeo pasa a principal** al enlazar con un ejercicio que solo tenía la lámina fija de
   free-exercise-db; la lámina se conserva como secundaria.

## 3. Herramienta

`yarn db:import:biblioteca --manifest=<entrega>/manifiesto.json [--dir=<entrega>] [--apply]`
(`src/workers/exercise-library-import.command.ts`; en el contenedor,
`node dist/workers/exercise-library-import.command.js`).

- Simulación por defecto. Con `--apply`, todo o nada: valida la entrega entera antes de escribir
  (esquema zod, SHA-256 de cada archivo, ffprobe contra `LIBRARY_VIDEO_PROFILE`, que existan los
  enlaces, nombres sin choques, máximo de 10 medios activos). El almacén no borra (ADR-0010).
- La imagen del servidor no trae ffmpeg: allí se valida el informe de ffprobe que guarda el
  manifiesto, atado al archivo por su SHA-256. Donde hay ffprobe se vuelve a sondear.
- Idempotente: `external_version` es la huella de la catalogación y cada medio se compara por
  SHA-256; una segunda pasada no cambia nada.
- Después de cargar: `yarn db:enrich:exercises` para rellenar `training.exercise_muscles` a partir
  de `target_muscle` (vocabulario cerrado en el manifiesto).

La lógica de decisión es pura y está probada sin base de datos:
`src/modules/exercises/import/exercise-library-manifest.ts` (+ `.spec.ts`).

## 4. Preparación de la entrega (fuera del repo)

Carpeta de trabajo `~/GymSheetMedia/biblioteca-2026-10/` (originales y másteres no van a MinIO):

1. `scripts/inventario.py` — copia con NFC, SHA-256 y ffprobe → `inventario.json`.
2. `scripts/hojas-gif.mjs`, `scripts/segmentar-videos.py`, `scripts/hojas-video.mjs` — hojas de
   contactos y segmentos candidatos de los MP4 (por cambio de color del panel de músculos).
3. Catalogación visual por bloques → `borradores/*.json` según `INSTRUCCIONES-CATALOGACION.md`.
4. `revision.json` (decisiones humanas) y `recortes.json` (franja de cada clip, revisada con
   `scripts/hojas-recorte.mjs`).
5. `scripts/construir-entrega.py` — une, convierte y escribe `entrega/manifiesto.json`.

El manifiesto validado se versiona en `data/exercise-library/biblioteca-2026-10.json`.

## 5. Orden de despliegue

Local → dev (Coolify) → test (Contabo), con revisión visual entre cada paso. En dev y test la
carga se ejecuta dentro del contenedor de la API, porque MinIO solo es accesible desde la red
interna: copiar `entrega/` al VPS, `docker cp` al contenedor, simulación, y `--apply`.
