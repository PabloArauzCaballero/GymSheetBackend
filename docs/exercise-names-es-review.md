# Nombres de ejercicio en español: borrador, revisión y activación

El catálogo tiene 1.324 ejercicios (snapshot de arranque). `nombre_es` se publica **solo**
cuando una persona lo ha revisado: no se publica traducción automática sin revisión.

| Archivo | Qué es |
|---|---|
| `src/database/seeders/showcase/exercise-names-es.data.ts` | 343 nombres revisados a mano (los de las plantillas REPP). Siempre `revisado: true`. |
| `src/database/seeders/showcase/exercise-names-es.borrador.data.ts` | 981 nombres en borrador, `revisado: false`. |
| `src/database/seeders/showcase/exercise-names-es.glosario.ts` | Glosario REPP (es-LA) y lista de palabras inglesas prohibidas. |
| `src/database/seeders/showcase/exercise-names-es.catalog.ts` | Une ambos; `reviewedSpanishNames()` devuelve solo lo revisado. |
| `docs/exercise-names-es-review.csv` | Hoja de revisión: `id, nombre_en, nombre_es, revisado, comentario`. |

El sembrador `routines-showcase` solo escribe `nombre_es` de las entradas con `revisado: true`
(y solo si el nombre en inglés de la base coincide con `en`).

## Cómo revisar y activar un lote

1. Abre `docs/exercise-names-es-review.csv` (filtra `revisado = false`; empieza por las filas con
   comentario, que son los casos dudosos). Compara con el vídeo/descripción cuando haya duda.
2. Corrige `es` en `exercise-names-es.borrador.data.ts` para las filas que lo necesiten
   (respeta el glosario: «Press de banca con barra», mayúscula solo en la primera palabra).
3. Cambia `revisado: false` por `revisado: true` en las entradas ya revisadas (un lote = un
   commit; no hace falta mover entradas de archivo).
4. Verifica sin base de datos:
   ```bash
   node scripts/verify-exercise-names-es.mjs          # cobertura, vacíos, duplicados, inglés residual, longitud <= 80
   node scripts/export-exercise-names-es-review.mjs   # regenera el CSV
   yarn test src/database/seeders/showcase
   ```
5. Despliega y vuelve a lanzar `yarn db:seed:showcase` (idempotente): escribe los nombres activados.
   El verificador exige Node >= 22.18 (importa los `.ts` directamente).

Reglas del glosario: «kettlebell» se conserva (consistencia con los revisados); duplicados de
origen se desambiguan con «(variante N)» o un calificativo; «(hombre)/(mujer)» solo aparece
cuando distingue duplicados.
