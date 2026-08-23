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
       + 10 × días de la racha más larga
       + recompensa de cada insignia conseguida
```

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
GET  /api/v1/me/progression              estado completo
POST /api/v1/me/progression/acknowledge  las novedades dejan de serlo
GET  /api/v1/me/progression/leaderboard  clasificación del gimnasio
```

La clasificación muestra nombre de pila e inicial («Ana P.»): una tabla pública
con el nombre completo de cada socio sería una lista de clientes del gimnasio.

## 10. Qué mirar si algo va mal

| Síntoma | Dónde mirar |
|---|---|
| La senda está vacía | ¿Se ejecutó `yarn db:seed:base`? |
| «Grupos trabajados» siempre 0 | ¿Se ejecutó `yarn db:enrich:exercises`? Sin taxonomía no hay grupos. |
| Los rangos son los neutros | `usuarios.genero` es nulo; se pregunta en el registro y se edita en el perfil. |
| La racha se corta cada noche | Zona horaria: los días se agrupan con `BUSINESS_TIME_ZONE`, no en UTC. |
