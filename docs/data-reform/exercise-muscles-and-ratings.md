# Ejercicios: músculos, grupos musculares y valoraciones

> Entregable para presentación a directorio. Todo lo aquí descrito está
> **implementado y verificado end-to-end** contra la pila Docker.

## 1. Qué se construyó

Un modelo relacional normalizado que responde, para cada ejercicio, **qué músculos
trabaja y con qué rol**, agrupados por **grupo muscular** (para recomendaciones), más
dos capas de valoración: una **editorial en estrellas** (recomendado / diversión) y la
**preferencia personal de cada usuario** (favorito + valoración 1–5).

### Cobertura real (1324 ejercicios del catálogo)
| Métrica | Valor |
|---|---|
| Grupos musculares | 10 |
| Músculos catalogados (con nombre latino) | 36 |
| Ejercicios con músculos mapeados | **1324 / 1324 (100 %)** |
| Relaciones ejercicio↔músculo (primario/secundario) | 3 842 |
| Ejercicios con valoración editorial | 1 324 |

Distribución por grupo (relación primaria): ARMS 630 · SHOULDERS 360 · LEGS 314 ·
BACK 282 · CHEST 216 · GLUTES 215 · CORE 183 · CALVES 70 · CARDIO 29.

## 2. Modelo de datos (esquema `training`)

- `muscle_groups` — 10 regiones (Pecho, Espalda, Hombros, Brazos, Core, Piernas,
  Glúteos, Pantorrillas, Cuello, Cardiovascular).
- `muscles` — músculo específico con `latin_name` y grupo (FK). 36 músculos.
- `exercise_muscles` — relación `ejercicio ↔ músculo` con `role`
  (`PRIMARY` / `SECONDARY` / `STABILIZER`). PK compuesta.
- `exercise_ratings` — 1:1 con ejercicio: `recommended_stars`, `fun_stars` (1–5) y
  `factors` (jsonb con el desglose auditable de la fórmula).
- `user_exercise_preferences` — `usuario ↔ ejercicio`: `is_favorite`,
  `personal_rating` (1–5), `notes`. PK compuesta.

Migración: `202608130002-exercise-muscles-and-ratings` (reversible).

## 3. Procedencia de los datos (sin invención)

El mapeo ejercicio→músculo se deriva de **campos reales ya presentes en el catálogo**
(`target_muscle`, `grupo_muscular`, `synergist_muscle_group`, `secondary_muscles`),
normalizados a la taxonomía anatómica mediante un diccionario de alias construido a
partir de los valores realmente observados en los datos (ver
[`muscle-taxonomy.ts`](../../src/modules/exercises/muscles/muscle-taxonomy.ts)). No se
fabrican relaciones: una etiqueta que no resuelve queda sin mapear (0 casos).

El proceso es **offline** (no llama a ningún repositorio externo) y **determinista e
idempotente**: reconstruye por completo las relaciones y ratings; dos corridas
consecutivas dejan 3 842 relaciones y 1 324 ratings (sin duplicados).

Comando: `yarn db:enrich:exercises` (prod: `db:enrich:exercises:prod`).

## 4. Metodología de las estrellas (transparente, auditable)

Las estrellas editoriales **no son aleatorias ni una afirmación médica**: son una
heurística transparente calculada a partir de atributos objetivos del ejercicio y
almacenada junto a su desglose (`factors`), por lo que es revisable y ajustable.

- **Recomendado** = 0.5·(compuesto: nº de músculos) + 0.3·(valor de categoría:
  fuerza/olímpico > cardio > estiramiento) + 0.2·(accesibilidad de equipamiento:
  peso corporal > mancuerna > barra > máquina).
- **Diversión** = 0.5·(dinamismo: pliometría/olímpico/cardio alto; estiramiento bajo)
  + 0.3·(variedad muscular) + 0.2·(accesibilidad).

La afinidad **subjetiva** real se captura por separado y por persona en
`user_exercise_preferences` — que es lo correcto: lo divertido depende de cada quien.

## 5. API (verificada end-to-end)

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/api/v1/muscle-groups` | Catálogo de grupos con sus músculos. |
| GET | `/api/v1/muscle-groups/:code/exercises?limit=` | Ejercicios que trabajan el grupo, ordenados por estrellas (recomendación). |
| GET | `/api/v1/exercises/:id/muscles` | Músculos primarios/secundarios + rating editorial del ejercicio. |
| PUT | `/api/v1/me/exercises/:id/preference` | Fija favorito / valoración personal del usuario autenticado. |
| GET | `/api/v1/me/exercises/preferences` | Preferencias del usuario autenticado. |

Ejemplo real (`archer push up`): primarios = Pectoral mayor + Tríceps braquial;
secundario = Deltoides; recomendado ★5, diversión ★4.

## 6. Recomendaciones habilitadas

El modelo ya permite: "dame ejercicios de **pecho** ordenados por recomendación",
"qué músculos entrena este ejercicio", "mis ejercicios favoritos", y sienta la base
para rutinas por grupo muscular y por afinidad personal.

## 7. Evidencia ejecutada

- `yarn type-check` ✅ · `yarn lint` ✅ · `yarn test` ✅ (suite completa).
- `db:enrich:exercises`: 1324/1324 mapeados, 0 sin mapear, 3 842 relaciones, 1 324 ratings.
- Idempotencia: 2ª corrida → mismos conteos, sin duplicados.
- Smoke test autenticado de los 5 endpoints en Docker: 200 con datos correctos.
