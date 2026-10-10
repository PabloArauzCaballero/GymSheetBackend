# Seeders

Los seeds usan Sequelize, la misma configuración del runtime y claves naturales
estables (correo). Pueden repetirse: actualizan únicamente los campos gestionados
por el seed y nunca crean duplicados.

```bash
yarn db:seed:base
yarn db:seed:mock
yarn db:seed:all:development
```

El seed base requiere `SEED_ADMIN_EMAIL` y `SEED_ADMIN_PASSWORD`. El seed mock
requiere `SEED_MOCK_PASSWORD` y se niega a ejecutar con `NODE_ENV=production`.
Las contraseñas se reciben por entorno, se almacenan como hash bcrypt y nunca se
incluyen en logs. Los usuarios mock cubren entrenador, atleta y usuario inactivo.

Seeders opcionales para usuarios administradores y catálogo inicial.

## Catálogo de ejercicios en el arranque

Con `CANONICAL_EXERCISES_SOURCE=seeders` (el valor por defecto), la siembra base
aplica `boot/exercises.snapshot.json.gz`: 1.324 ejercicios con su descripción en
español, sus instrucciones por idioma y el resto de datos detallados. Sin red y
sin esperar al worker del dataset, de modo que una instalación nueva abre la
pantalla de ejercicios con contenido.

Solo inserta lo que falta —un ejercicio ya presente no se toca— y va antes de
`seedExerciseEquipment`, que es quien enlaza cada ejercicio con su máquina: en
una base limpia el mismo arranque deja 1.324 ejercicios y 1.078 enlaces.

Con `CANONICAL_EXERCISES_SOURCE=github` no se aplica nada: ahí el poblador sigue
siendo `yarn worker:exercises-dataset`.

Para regenerar el snapshot desde una base ya poblada y versionarlo:

```bash
yarn db:snapshot:exercises
```

Es determinista —ordena por identificador externo y no guarda ids ni fechas—, así
que regenerarlo sin cambios en el catálogo no produce diferencias en git.

## Datos de demostración de rutinas (`routines-showcase`)

`src/database/seeders/showcase/` siembra lo que se enseña en TEST (10_CORRECCIONES
§C6/§C7): las 20 rutinas oficiales «Recomendadas por REPP» (autor «Equipo REPP»,
`metadata.plantilla`), el diccionario revisado de `nombre_es` (343 ejercicios), 8
personas `@demo.repp.test` con onboarding completo, rutinas de comunidad, copias con
atribución, valoraciones, comentarios (uno oculto por moderación), «me gusta» y
favoritos, y 3 programas con semanas registradas cuyo libro de recompensas sale del
cierre semanal real.

```bash
SEED_SHOWCASE_PASSWORD=… yarn db:seed:showcase        # ts-node (desarrollo)
SEED_SHOWCASE_PASSWORD=… yarn db:seed:showcase:prod   # imagen construida (TEST)
```

- Requiere el catálogo base (`yarn db:seed:base`): si falta un ejercicio de una
  plantilla, **falla** sin sembrar rutinas.
- Usa los servicios reales (no INSERT), es idempotente por claves naturales y
  **se niega a correr con `NODE_ENV=production`**.
- **No corre al arrancar** ningún contenedor: se lanza a mano cuando se quiera
  poblar TEST. La contraseña de las cuentas demo sale de `SEED_SHOWCASE_PASSWORD`
  (o `SEED_MOCK_PASSWORD`); la cuenta de autoría de REPP recibe una aleatoria.
- Para limpiar antes los datos de QA: `scripts/sql/limpieza-qa-test/` (01 → 05).
