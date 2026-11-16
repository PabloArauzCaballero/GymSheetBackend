# Conocer: ranking local (franja 5)

## Qué cambia

La baraja `GET /me/discovery/deck` deja de ordenarse por puntos de gamificación. El orden
lo da una consulta SQL (`src/modules/social/discovery-ranking.sql.ts`) basada en los
factores que Tinder describe públicamente desde que abandonó Elo en 2019 (actividad,
coincidencia horaria, preferencias, ubicación, probabilidad de like mutuo), más afinidad
de entrenamiento y verificación. No hay puntuación de deseabilidad, los puntos no son un
insumo y la orientación sexual nunca se lee (lo afirma
`discovery-ranking.compose.spec.ts`).

### Filtros duros (antes de puntuar)

Mayor de 18, correo verificado, 2+ fotos visibles, perfil social activo, preferencias en
los dos sentidos (géneros y rango de edad de cada uno incluyen al otro; `flexibleAge`
amplía ±2 años con penalización de 0,05 por año), dentro del radio (`flexibleDistance`:
hasta 1,5× con `D` negativo), sin bloqueo en ningún sentido, sin decisión previa (cualquier
conexión salvo el like pendiente que la otra persona envió, y sin descarte propio), mismo
gimnasio o consentimiento cross-gym de ambos.

### Puntuación

`S = 0,25·A + 0,20·M + 0,15·D + 0,10·I + 0,15·F + 0,10·V + 0,05·N − penalización de edad`.
Los pesos salen de `social.ranking_config` (versión `v1` sembrada, mismos valores en código).

| Factor | Cálculo |
|---|---|
| A actividad | 1 si entrena ahora (sesión `EN_PROGRESO` o acceso `GRANTED` en las últimas 3 h); si no `exp(−h/48)` con `h` = horas desde `max(last_active_at, last_seen_at)`; +0,1·Jaccard de horas activas de 14 días (tope 1) |
| M like mutuo | 1 si ya le dio like al viewer; si no, su tasa de likes de 90 días suavizada (prior de 10 decisiones) hacia la tasa global. **Simplificación:** no es la tasa hacia perfiles parecidos al viewer, es la tasa general |
| D distancia | `1 − d/radio` (Haversine). Viewer: su ubicación del mapa (< 24 h) o su sede. Candidato: el centro de su celda pública de ~2 km o su sede, nunca la coordenada guardada |
| I intención | Jaccard de intenciones; `UNSURE` vale 0,5 con cualquiera |
| F afinidad | promedio de las señales disponibles: mismo objetivo, misma rutina activa (programa o asignación), frecuencia semanal parecida, misma sede, Jaccard de intereses, estado social compatible si el viewer busca `DATING` |
| V verificación | 1 si `usuarios.verified_at` (franja 6 la llena; hoy nula → 0) |
| N novedad | 1 las primeras 72 h desde el alta, lineal a 0 a los 7 días |

Composición de página (`discovery-ranking.compose.ts`): quienes ya dieron like al viewer van
a las posiciones 3–6 (nunca primeros), cada décima posición se reserva para una cuenta de
menos de 7 días si existe, el resto en orden de puntuación.

### Paginación

Keyset `(score, id)` dentro de un snapshot: el cursor firmado existente lleva `asOf` (todas
las lecturas de reloj de la consulta usan ese instante), la versión de configuración, la
posición, la clave, los likes pendientes de ubicar y los ids servidos fuera de orden.

### Actividad

`usuarios.last_active_at` y `usuarios.active_hours` (24 fechas, una por hora local) se
escriben desde la validación del JWT como máximo cada 5 minutos por cuenta
(`UserActivityService`, sin bloquear la petición).

## Contrato para clientes

- Cada carta de la baraja suma `reasons: string[]` (`NEARBY`, `TRAINING_NOW`, `ACTIVE_NOW`,
  `SAME_GOAL`, `SAME_ROUTINE`, `SHARED_INTERESTS`, `VERIFIED`, `NEW_HERE`; ignorar códigos
  desconocidos) y `distanceKm: number | null` (entero, mínimo 1).
- Cabecera nueva `X-Ranking-Config` con la versión que ordenó la página.
- La baraja ahora puede incluir a quien ya dio like al viewer (antes quedaba oculto).
- Cartas fuera de los filtros duros desaparecen (sin 2 fotos, sin correo verificado, fuera
  de radio, preferencia no recíproca, viewer sin fecha de nacimiento o sin sexo declarado).
- `POST /me/discovery/swipes` ya no exige haber llamado antes a `POST /me/discovery/impressions`:
  la impresión se marca vista al decidir. Una impresión reutilizada o vencida sigue dando 409.
- Modelo único de match: `POST /me/connections` (conectar desde directorio o mapa) y
  `PATCH /me/connections/:id {ACCEPT}` (aceptar en el panel de likes) son un LIKE: el like
  mutuo crea la conexión `ACCEPTED`, la conversación directa y el aviso, también desde el
  directorio (antes el auto-aceptado no creaba la conversación). Un LIKE borra un descarte
  previo propio. Mismos códigos HTTP; los 404 de bloqueo/ajeno dicen «Usuario no encontrado».

## Métricas (F5.11)

Contadores en `/health/metrics`: `discovery_cards_served_total{config}`,
`discovery_decisions_total{config,direction}`, `discovery_matches_total{config}` y
`discovery_match_position_total{config,bucket}`; logs `discovery.decision.recorded`. La
atribución usa `discovery_impressions.ranking_version/ranking_position`; sin impresión,
`config="none"`. Asignación A/B: hash SHA-256 estable del id del viewer repartido por
`traffic_weight` entre las versiones activas de `social.ranking_config`.

## Evidencia de rendimiento

Base desechable `gym_sheet_f5_perf` (esquema + migraciones) con
`test/load/discovery-deck-seed.sql`: 10.000 miembros, 20.000 fotos, 40.000 descartes,
20.000 conexiones, 5 sedes. PostgreSQL 16 y la API en la misma VM de 4 vCPU **compartida
con otras sesiones** (load average 3–10 durante las mediciones), así que los números son
ruidosos.

`EXPLAIN (ANALYZE, BUFFERS)` de la consulta para un viewer (356 candidatos puntuados):
[`discovery-ranking-explain.txt`](discovery-ranking-explain.txt). Planificación ≈ 10 ms,
ejecución ≈ 29 ms; 30 ejecuciones seguidas: p50 31 ms, p95 34 ms.

| Cambio medido | Antes | Después |
|---|---:|---|
| Factores inline → `feat`/`scored` MATERIALIZED, radio filtrado antes de calcular factores, Jaccard sin `INTERSECT/UNION` | ejecución 61,7 ms, p50 44 ms | ejecución 29 ms, p50 31 ms |
| Pool sin índice ([explain](discovery-ranking-explain-no-pool-index.txt)) vs `ix_usuarios_discovery_active` | seq scan 5.000 filas + sort ≈ 4 ms | index scan 300 filas ≈ 0,4–0,7 ms |

Con 10.000 miembros el índice del pool ahorra pocos milisegundos; lo que importa es que su
costo no crece con el tamaño del gimnasio. El costo dominante es puntuar ~350 candidatos.

Carga `test/load/discovery-deck-load.mjs` (10 viewers, 400 peticiones, mitad primera página
y mitad continuación con cursor, `limit=10`, 4.000 cartas servidas, 0 errores), con el
código final:

| Concurrencia | p50 | p95 | p99 | max | load average al empezar |
|---:|---:|---:|---:|---:|---|
| 1 | 49 ms | 85 ms | 101 ms | 141 ms | 6,3 |
| 5 | 118 ms | 229 ms | 328 ms | 464 ms | 6,8 |
| 10 | 182 ms | 275 ms | 338 ms | 392 ms | 8,0 |
| 10 | 177 ms | 254 ms | 352 ms | 404 ms | 9,4 |

Objetivo p95 < 300 ms: cumplido en las cuatro corridas, con poco margen a concurrencia 10 en
esta VM compartida. Antes de dos correcciones medidas en la misma sesión la concurrencia 10
daba p95 379 ms (factores inline) y 395–430 ms: el `RecommendationsClient` está siempre
registrado, así que sin `RECOMMENDATIONS_URL` cada petición rankeaba dos veces (pool para el
recomendador + respaldo local, visto con `log_min_duration_statement = 0`); ahora el
recomendador sólo interviene si está configurado. Por petición quedan: una consulta de
ranking (≈ 27 ms en el servidor), la ficha del directorio (≈ 4–9 ms), el insert de
impresiones (≈ 1 ms) y lecturas por clave primaria. El costo es CPU de PostgreSQL (≈ 10 ms
de planificación); palancas no aplicadas: plan preparado o cachear el snapshot por viewer
para las páginas de continuación.

Reproducir: crear la base, migrar, arrancar la API con `SIGNUP_TICKET_REQUIRED=false
SIGNUP_MIN_FILL_MS=0 RATE_LIMIT_MAX=10000` y ejecutar
`LOAD_SEED=1 BASE_URL=… DB_NAME=… DB_USER=… DB_PASSWORD=… node test/load/discovery-deck-load.mjs`.
