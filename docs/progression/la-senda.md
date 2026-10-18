# La Senda — progresión gamificada

El camino hacia tu imagen ideal: rangos, insignias y puntos, filtrados por
género y administrables por cada gimnasio.

Este documento recoge **por qué** el sistema está diseñado así. El *qué* vive en
el código (`src/modules/progression/`) y el catálogo real vive en la base de
datos, que es lo único que manda en tiempo de ejecución.

---

## 1. El problema que resuelve

GymSheet registra series con precisión. Eso resuelve *«¿qué hice?»* y no
resuelve *«¿me estoy acercando a como quiero verme?»*, que es la pregunta por la
que alguien vuelve al gimnasio y, por tanto, a la aplicación.

Un historial es un archivo. Una senda es una historia con un sitio donde estás y
un sitio al que vas.

## 2. La narrativa

### La metáfora

No es una barra de progreso: es un **camino** con hitos visibles. Se ve dónde
estás, cuál es el siguiente y cuántos quedan. Los hitos pendientes **no se
ocultan**: se muestran apagados, con su nombre legible y sus puntos exactos.

### Los cuatro principios del texto

1. **Los rangos nombran identidad, no tareas.** «GYM RAT» dice quién eres; «12
   entrenamientos» dice qué hiciste. Lo primero se lleva puesto y se cuenta a un
   amigo; lo segundo se olvida. Cada rango tiene un `tagline` en segunda persona
   y en presente.
2. **La meta siempre a la vista.** Un camino con la meta visible aprieta el paso
   cuando está cerca. Por eso la pantalla dice siempre *«te faltan N puntos para
   X»* con la cifra exacta, y no un porcentaje redondeado.
3. **La primera victoria llega en días, no en meses.** El salto al segundo rango
   cuesta unas cuatro sesiones. Un primer premio lejano no engancha; lo que
   engancha es comprobar pronto que el sistema responde.
4. **Nunca se culpa.** Perder una racha es un hecho, no un reproche. El texto de
   una racha rota invita a empezar otra hoy y no menciona el fallo:
   *«Tu racha está en cero. Un entrenamiento hoy y vuelve a contar.»*

### El tono

Directo, en segunda persona, frases cortas. Celebra sin condescender: *«Rango
desbloqueado: GYM RAT»*, no *«¡Felicidades, lo lograste!»*. La línea de sabor de
cada insignia es parte del premio: *«Mil kilos movidos por ti. La primera de
muchas.»*

## 3. El filtrado por género

Un arquetipo motiva cuando uno se reconoce en él, y la imagen ideal de un socio
no es la de una socia. Hay **tres ramas completas** de ocho rangos:

| Rama | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 |
|---|---|---|---|---|---|---|---|---|
| `MALE` | Novato | Constante | Gym Rat | Bestia | Máquina | Titán | Super Guerrero | Instinto Puro |
| `FEMALE` | Novata | Constante | Gym Girl | Fiera | Máquina | Valquiria | Amazona | Instinto Puro |
| `ANY` | Chispa | Hábito | Gym Rat | Fuerza Bruta | Máquina | Titanio | Élite | Instinto Puro |

Decisiones que sostienen esto:

- **`ANY` no es un descarte.** Es la rama neutra, con los mismos ocho rangos y la
  misma fuerza, para quien no quiera declarar nada. Usa sustantivos sin género
  gramatical —objetos, materiales, estados— en vez de dobletes con barra, que se
  leen como un formulario y no como un rango.
- **Los tres caminos comparten umbrales.** Si una rama subiera más rápido, elegir
  género dejaría de ser una cuestión de identidad y pasaría a ser una ventaja.
  Hay una prueba que lo fija (`progression.spec.ts`).
- **Un usuario ve un solo camino.** Las ramas no se mezclan: unir dos daría una
  lista de trece paradas con dos historias entrelazadas.
- **Las insignias sí se comparten.** Casi todas son `ANY`: un premio por levantar
  cien toneladas no cambia según quién las levante. Solo se separan por género las
  que **nombran** a quien las gana, y esas comparten `code` para que nadie reciba
  dos premios por un mismo logro.
- **El género se puede cambiar siempre**, y volver a «prefiero no decirlo». Es un
  dato sobre quién es alguien: bloquearlo tras el registro convertiría un
  descuido en una etiqueta permanente.
- **No se pide para poder entrar.** Es opcional en el registro y editable desde el
  perfil. Vive en `usuarios.genero` y no en el perfil antropométrico porque ese
  perfil exige peso y estatura: obligar a medirse para poder elegir cómo te llama
  la aplicación sería pedir un dato íntimo a cambio de otro.

## 4. Sobre los nombres

El encargo pedía referencias directas de cultura anime («nivel Goku»). Los
nombres **sembrados** evocan ese registro sin usar marcas registradas ajenas,
porque el catálogo viaja dentro de un producto que se vende a gimnasios.

Como los rangos son editables desde la API de administración, un gimnasio que
quiera llamar «Goku» a su séptimo rango lo hace con un `PATCH` y sin desplegar
nada:

```http
PATCH /api/v1/admin/progression/levels/{id}
{ "name": "Goku", "tagline": "Rompiste tu propio techo." }
```

## 5. Los puntos

```
puntos = 50 × sesiones finalizadas
       +  2 × series registradas
       +  1 × cada 100 kg de volumen
       + 10 × días de la racha más larga (con comodines)
       + recompensa de cada insignia conseguida
       + bonos de los programas con modo (libro de solo inserción)
       + retos de la semana cumplidos (60 / 100 / 160) + 150 por semana redonda
```

`breakdown` (en la senda y en el premio de cada sesión) desglosa las siete
partidas: `session`, `sets`, `volume`, `streak`, `badges`, `modes` y
`challenges`. `GET /me/progression/rules` publica las cifras, incluidas
`challengePoints`, `perfectWeekBonus`, `freezeEveryDays` y `maxFreezes`.

Calibración: una sesión corriente —veinte series, cinco toneladas— ronda los
**150 puntos**. Hay una prueba que lo fija; si esa cifra se mueve sin mover los
umbrales, la senda entera se recoloca sin que nadie lo note.

Decisiones:

- **Solo cuentan las sesiones finalizadas.** Admitir sesiones abiertas dejaría
  subir de rango abriendo sesiones vacías, que es la forma más rápida de que el
  sistema deje de significar nada.
- **La racha se paga sobre la más larga, no sobre la vigente.** Los puntos son un
  historial y no deberían bajar por descansar. La racha en curso ya tiene su
  propio sitio destacado en la pantalla.
- **Todo se recalcula en cada lectura.** Es más caro que un contador incremental
  y es lo único que sobrevive a que un administrador cambie un umbral o a que se
  corrija una serie mal registrada.

### Umbrales

| Rango | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 |
|---|---|---|---|---|---|---|---|---|
| Puntos | 0 | 500 | 1 500 | 4 000 | 9 000 | 18 000 | 32 000 | 55 000 |

A tres sesiones por semana: rango 2 en semana y media, rango 4 sobre el segundo
mes, rango 8 a un par de años.

## 6. Las insignias

28 sembradas, en seis categorías: `CONSTANCIA`, `VOLUMEN`, `FUERZA`, `VARIEDAD`,
`HITO` y `SECRETA`; cuatro rarezas: `COMUN`, `RARA`, `EPICA`, `LEGENDARIA`.

Cada una declara un `criterion_type` y un umbral. Las trece métricas disponibles
salen todas de los entrenamientos registrados:

`SESSION_COUNT` · `STREAK_DAYS` · `WEEKLY_STREAK` · `TOTAL_VOLUME_KG` ·
`SINGLE_SESSION_VOLUME_KG` · `TOTAL_SETS` · `TOTAL_REPS` ·
`DISTINCT_MUSCLE_GROUPS` · `DISTINCT_EXERCISES` · `EARLY_SESSIONS` ·
`NIGHT_SESSIONS` · `WEEKEND_SESSIONS` · `PERSONAL_RECORDS`

Las **secretas** no se anuncian: aparecen ya conseguidas. Son la parte de
recompensa impredecible del sistema —lo que hace que abrir la pantalla tenga algo
que descubrir incluso en una semana floja— y por eso premian comportamientos que
nadie perseguiría si supiera que dan puntos (entrenar antes de las 7, después de
las 21, en fin de semana).

Una insignia pendiente muestra su distancia exacta («8 / 9», «24.000 kg /
100.000 kg»): sin distancia visible no motiva a nadie.

### La racha semanal

`WEEKLY_STREAK` cuenta semanas seguidas con al menos un entrenamiento. Es la
métrica de constancia de quien entrena tres días por semana: la racha diaria
nunca premia a esa persona, aunque lleve un año sin fallar.

### Tercera tanda (2026-10-18)

- **Rachas largas** `RACHA_60`, `RACHA_200`, `RACHA_365`: con las de 3, 7, 14,
  30 y 100 completan los hitos de racha con carta propia.
- **Retos**: `CHALLENGES_COMPLETED` (1 / 10 / 50 / 150) y `PERFECT_WEEKS`
  (4 / 12).
- **Secretas nuevas**: Volviste (`COMEBACK_SESSIONS`, tras 14 días enteros sin
  venir; celebra la vuelta sin mencionar la ausencia), Doble turno
  (`MAX_SESSIONS_IN_DAY` ≥ 2), Maratón (`LONGEST_SESSION_MINUTES` ≥ 120, medido
  hasta la última serie apuntada para que una sesión olvidada abierta no
  cuente), Medianoche (`MIDNIGHT_SESSIONS`, inicio entre 00:00 y 04:00), Año
  nuevo (`NEW_YEAR_SESSIONS`), Feliz cumpleaños (`BIRTHDAY_SESSIONS`, sale de
  `perfiles_antropometricos.fecha_nacimiento`), Día de récords
  (`MAX_RECORDS_IN_SESSION` ≥ 3) y Escudo arriba (`MODE_SHIELDS_USED`).
- **Modo**: Cuatro semanas de leyenda (`MODE_MAX_MULTIPLIER_WEEKS` ≥ 4, semanas
  cumplidas con el multiplicador en x2,0).

Las ilustraciones de los criterios nuevos reutilizan claves que los clientes ya
dibujan (`badge-illustrations.ts`).

### Cadenas y «lo más cerca»

Cada `BadgeView` lleva `chain` (su criterio), `chainStep` (posición por umbral,
desde 1) y `chainLength`: la colección puede agrupar las insignias del mismo
criterio en una sola ficha «Nivel 2 de 4». Las secretas forman cadena aparte
para no delatar que existen.

`nearest` son hasta tres insignias sin conseguir y no secretas, de más a menos
progreso: «te faltan 2 sesiones para Medio centenar» es lo que trae de vuelta.

## 6.1 La racha que perdona: comodines

Cada **7 días** de racha diaria se gana un **comodín**, con un máximo de **dos**
guardados. Si falta un día que no es de descanso declarado, se gasta uno solo y
la racha sigue; el día cubierto no suma, solo no rompe. Si el hueco pide más
comodines de los que hay, la racha se corta y los comodines se van con ella.

Se calcula entero desde el historial (`computeStreaks`), sin estado guardado:
recalcular da lo mismo, y corregir una sesión recoloca los comodines solos. Los
comodines solo alargan rachas, así que la más larga —y sus puntos— nunca baja
respecto a la regla anterior (hay una prueba de propiedad con 1000 historiales).

`GET /me/progression` → `streak: { current, longest, freezes, freezesUsed,
nextMilestone, weekly }`, con `nextMilestone` en [3, 7, 14, 30, 60, 100, 200,
365]. El premio de la sesión añade `freezeEarnedNow` y `milestoneNow`.

## 6.2 Retos de la semana

Cada lunes cada socio tiene **tres retos** (fácil, medio, difícil) que valen
**60 / 100 / 160** puntos; los tres cumplidos son una **semana redonda**
(+150). Tipos: `SESSIONS`, `VOLUME_KG`, `SETS`, `NEW_EXERCISE`,
`PERSONAL_RECORD`, `EARLY_SESSION` (antes de las 9), `CARDIO_MINUTES`,
`MUSCLE_GROUPS`, `GEO_SESSIONS` y `WEEKEND_SESSION`.

- **Personalizados**: el objetivo sale de la media de las cuatro semanas
  anteriores (una semana sin entrenar cuenta como cero) por un factor de 0,75 /
  1 / 1,25, con mínimos para quien empieza y topes donde no tiene sentido
  crecer. No se propone cardio, fichar en la sede, madrugar ni batir marcas a
  quien no tiene ese historial.
- **Deterministas**: la semilla es `usuario:lunes`; la misma semana da siempre
  los mismos retos.
- **Guardados** en `progression.weekly_challenges` la primera vez que se ve la
  semana: cambiar la regla no reescribe retos ya cumplidos y sus puntos nunca
  bajan (un reto cumplido sigue cumplido aunque luego se borre una sesión).
- **Medidos en `BUSINESS_TIME_ZONE`**, lunes a domingo. Si la semana pasada
  quedó con algún reto abierto, la primera lectura de la semana nueva la revisa
  una vez más: la sesión del domingo que se sincroniza el lunes cuenta donde se
  entrenó.
- `isNew` = cumplido y sin celebrar; `perfectIsNew` = semana redonda con algún
  reto sin celebrar. `POST /me/progression/acknowledge` los limpia.

La foto previa al cierre de una sesión (`snapshot`) mide los retos sin
escribir, así que `challengesCompletedNow` y `perfectWeekNow` del premio de la
sesión son exactamente lo que cumplió esa sesión.

## 6.3 Premios del gimnasio

Un **premio** es algo real que da el gimnasio («Batido de proteína gratis»,
«Pase de un día para un amigo») atado a un hito: una insignia (`BADGE`), un
rango (`LEVEL`) o la semana redonda (`PERFECT_WEEK`). Sustituye a las
recompensas por racha `STREAK_REWARD_*`, que **ya no se otorgan**; las que ya se
dieron siguen en «Accesos».

- Al alcanzar el hito nace un **cupón** (`progression.user_prizes`) con código
  de 6 caracteres sin 0/O/1/I, estado `DISPONIBLE → CANJEADO | CADUCADO`,
  caducidad opcional (`validDays`) y stock opcional (`stock`, con bloqueo de fila
  y `granted_count`). `CADUCADO` se lee al vuelo cuando pasa `expires_at`; no
  hace falta ningún trabajo nocturno.
- Se otorga dentro de `getProgression`, como las insignias, y es idempotente
  por `UNIQUE (prize_id, usuario_id, source_ref)`: `source_ref` es el código de
  la insignia o del rango, o el lunes de la semana redonda (cada semana redonda
  da su propio cupón).
- **No es retroactivo**: una insignia cuenta si se consiguió después de crear el
  premio; un rango, si se cruza ahora (el guardado en `user_progress` era
  inferior); una semana redonda, desde la semana en que nació el premio. Un
  gimnasio que crea un premio no regala de golpe una unidad a cada socio que ya
  tenía el hito.
- Un premio de rango se ata a un **código**: con las ramas por género, usa un
  código común (`MAQUINA`, `INSTINTO_PURO`) o crea uno por rama.
- Sin premios activos, `prizes` va vacío y la app no promete nada. El seeder de
  demostración (`yarn db:seed:showcase`) siembra cuatro de muestra en el
  gimnasio por defecto; la siembra base nunca.

```
GET    /api/v1/me/progression/prizes                  = progression.prizes
GET    /api/v1/admin/progression/prizes               del gimnasio + globales (ADMIN) o todos (SYSTEM_ADMIN)
POST   /api/v1/admin/progression/prizes               {targetKind, targetCode?, title, description?, instructions?, icon?, validDays?, stock?, active?, alcance?}
PATCH  /api/v1/admin/progression/prizes/{id}
DELETE /api/v1/admin/progression/prizes/{id}          → active = false
POST   /api/v1/admin/progression/prizes/redeem        {code} → PrizeView CANJEADO · 404 fuera de su gimnasio · 409 ya canjeado o caducado
```

`alcance` y la edición siguen las mismas reglas que rangos e insignias
(`resolveCatalogTenant` / `assertEditable`): el gimnasio sale del token. El
canje lo hace el gimnasio del premio, o el del socio si el premio es global; un
código de otro gimnasio responde 404 igual que uno inexistente.

## 6.4 Modo: escudo y caída suave

- **Caída suave**: una semana incumplida baja **dos escalones** (−0,4, mínimo
  x1,0) en vez de volver a x1,0. Tras ocho semanas buenas, una gripe ya no lo
  borra todo.
- **Escudo**: cuatro semanas cumplidas seguidas (sin contar las semanas sin
  plan) dan un escudo, máximo uno (`training_programs.escudos`). Una semana
  incumplida con escudo lo gasta y **conserva** el multiplicador, sin bono esa
  semana (`program_weeks.escudo_usado`).
- Cada escalón tiene nombre: x1,0 «Arrancando», x1,2 «En marcha», x1,4
  «Encendido», x1,6 «En llamas», x1,8 «Imparable», x2,0 «Leyenda». Las vistas de
  programa añaden `nivelMultiplicador` y `escudos`, el avance `escudoUsado` por
  semana, y los avisos de cierre nombran el escalón y el escudo.
- La meta alcanzada (+300) se suma en el `finish` de **esa** sesión: el enganche
  de programas corre antes de calcular el premio de la sesión.
- El libro de bonos sigue siendo de solo inserción: los puntos de modo nunca
  bajan (prueba de propiedad con 1000 secuencias, ahora con escudo).

## 7. Multi-inquilino

**La senda funciona igual sin importar el gimnasio.** El catálogo sembrado es
global (`tenant_id IS NULL`) y un gimnasio solo necesita crear filas si quiere
apartarse de él.

Resolución: dentro de la rama que le toca al usuario, un rango o insignia del
gimnasio con el mismo `code` que uno global **lo sustituye**. Así una marca
reescribe un hito suelto sin tener que redefinir los ocho.

## 8. Administración

Los endpoints existen y están sembrados; **la pantalla que los consumirá es
trabajo de otra sesión**.

```
GET    /api/v1/admin/progression/levels
POST   /api/v1/admin/progression/levels
PATCH  /api/v1/admin/progression/levels/{id}
DELETE /api/v1/admin/progression/levels/{id}     → desactiva, no borra

GET    /api/v1/admin/progression/badges
POST   /api/v1/admin/progression/badges
PATCH  /api/v1/admin/progression/badges/{id}
DELETE /api/v1/admin/progression/badges/{id}     → desactiva, no borra
```

Rol `ADMIN`. `DELETE` desactiva en vez de borrar: las insignias ya conseguidas
apuntan a su fila y borrarla las haría desaparecer del historial de quien las
ganó.

Estas rutas **no** están abiertas en el BFF de la web: la pantalla que las usará
todavía no existe, y abrir la ruta antes de tener quien la vigile sería dejar
accesible desde el navegador una API que nadie mira. Hay una prueba que fija ese
bloqueo (`backend-route-policy.test.ts`).

La siembra es idempotente y conservadora: crea lo que falta y refresca los
textos, pero **no toca `active`**. Un gimnasio que retiró un rango no quiere que
el siguiente despliegue se lo devuelva.

## 9. API del socio

```
GET  /api/v1/me/progression              estado completo (con streak, challenges, prizes y nearest)
GET  /api/v1/me/progression/rules        cuánto vale cada cosa
GET  /api/v1/me/progression/prizes       los cupones del socio
POST /api/v1/me/progression/acknowledge  las novedades (insignias, retos, cupones) dejan de serlo
GET  /api/v1/me/progression/leaderboard  clasificación del gimnasio
```

El `finish` de una sesión (`PATCH /workouts/{id}/finish`) devuelve en
`progression` el desglose de la sesión y, además, `challenges` (estado después),
`challengesCompletedNow`, `perfectWeekNow`, `prizesNow`, `streak` y `nearest`.
El contrato completo está en `PLAN_RUTINAS_REPP/12_PREMIOS_2026-10-18.md` §3.

La clasificación muestra nombre de pila e inicial («Ana P.»): una tabla pública
con el nombre completo de cada socio sería una lista de clientes del gimnasio.

## 10. Qué mirar si algo va mal

| Síntoma | Dónde mirar |
|---|---|
| La senda está vacía | ¿Se ejecutó `yarn db:seed:base`? |
| «Grupos trabajados» siempre 0 | ¿Se ejecutó `yarn db:enrich:exercises`? Sin taxonomía no hay grupos. |
| Los rangos son los neutros | `usuarios.genero` es nulo; se pregunta en el registro y se edita en el perfil. |
| La racha se corta cada noche | Zona horaria: los días se agrupan con `BUSINESS_TIME_ZONE`, no en UTC. |
| Un socio no recibe un premio | ¿Activo, con stock (`granted_count < stock`)? ¿El hito se alcanzó después de crear el premio? Los premios no son retroactivos. |
| Los retos no cambian en toda la semana | Es lo esperado: se generan una vez por semana y se guardan. |
| Feliz cumpleaños no salta | Necesita `fecha_nacimiento` en el perfil antropométrico. |
