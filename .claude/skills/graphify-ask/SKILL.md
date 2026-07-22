---
name: graphify-ask
description: Consulta de bajo coste (en tokens) contra un grafo graphify YA construido (graphify-out/graph.json). Úsala en vez de /graphify cuando solo quieras preguntar sobre el código/arquitectura y el grafo ya existe. Nunca vuelca el grafo; emite un subgrafo compacto acotado por presupuesto. Para (re)construir el grafo sigue usando /graphify.
---

# graphify-ask

Consultar un grafo graphify existente gastando el mínimo de tokens. NO construye grafos.

## Cuándo usarla
- Existe `graphify-out/graph.json` y el usuario hace una pregunta en lenguaje natural sobre el
  código, arquitectura o relaciones ("¿cómo funciona X?", "¿qué llama a Y?", "traza Z").
- Quieres el camino entre dos conceptos o explicar un nodo.

## Cuándo NO usarla
- No existe el grafo, o piden (re)construir / actualizar → usa `/graphify <ruta>` (o `--update`).

## Por qué ahorra tokens
El script `gq.py` es **stdlib pura**: no carga el paquete `graphify`, ni networkx, ni el CLI.
Hace la travesía en memoria y **solo imprime el subgrafo acotado** (`--budget`). El grafo de 3 MB,
`GRAPH_REPORT.md` y `graph.html` **nunca entran al contexto**. No hagas `cat`/`Read` de esos archivos.

## Uso

Desde la raíz del proyecto (donde vive `graphify-out/`):

```bash
python .claude/skills/graphify-ask/gq.py "<pregunta>"              # BFS, contexto amplio
python .claude/skills/graphify-ask/gq.py "<pregunta>" --dfs        # traza una cadena concreta
python .claude/skills/graphify-ask/gq.py "<pregunta>" --budget 800 # cap de tokens (def. 1200)
python .claude/skills/graphify-ask/gq.py --explain "NombreNodo"    # un nodo y sus conexiones
python .claude/skills/graphify-ask/gq.py --path "NodoA" "NodoB"    # camino más corto
```

Opciones: `--graph RUTA` (def. `graphify-out/graph.json`), `--depth D` (def. 3), `--starts K` (def. 3).
Si `python` no resuelve, usa `py -3` o el intérprete del proyecto.

## Procedimiento (mínimo gasto)

1. Verifica que exista `graphify-out/graph.json`. Si no, di que hay que construirlo con `/graphify` y para.
2. Lanza `gq.py` con la pregunta y un `--budget` **bajo primero** (p. ej. 800). Escala el budget o
   añade `--depth 4` solo si la salida no basta.
3. Responde usando **únicamente** el subgrafo devuelto. Cita `src=…/loc=…` de los NODE relevantes.
4. Si la travesía devuelve "Sin nodos que coincidan…", el corpus no cubre la pregunta: dilo, no inventes.
5. No vuelques el JSON, el reporte ni el HTML al contexto en ningún caso.

## Salida
Cabecera + líneas `NODE <label> [src=… loc=…]` y `EDGE A --relación [confianza]--> B`, rankeadas por
relevancia y truncadas al presupuesto. Las etiquetas y `source_location` son tus citas.
