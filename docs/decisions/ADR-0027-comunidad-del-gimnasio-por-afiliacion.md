# ADR-0027 — «Mi gimnasio», clasificación, sello «Socio de X» y Conocer por la afiliación confirmada (franja 7c)

Estado: **aceptado**
Fecha: 2026-11-17
Continúa [ADR-0025](./ADR-0025-afiliaciones-a-la-ficha-del-gimnasio.md) (afiliaciones a la ficha GYM). Convive
con ADR-0026 (8e, suscripciones), que confirma la SOCIO junto con la orden que la paga: esta decisión solo
**lee** afiliaciones.

## Contexto

Decisión del dueño (16/11/2026): «la afiliación confirmada abre Mi gimnasio, da el sello Socio de X y cuenta
en Conocer». Hasta a3c0a5f, «el gimnasio de una persona» era `usuarios.tenant_id`: la clasificación del
gimnasio listaba a todo el tenant y el móvil marcaba «Tu gimnasio» comparando `entities.tenant_id` con el
tenant de la sesión. Una persona del tenant por defecto sin afiliación veía la clasificación de todos (sonda
e2e ad hoc, no versionada, ejecutada contra a3c0a5f: `200` y la lista incluía a otra persona sin afiliación;
la misma sonda da `403` con esta franja). El tenant queda
como **instalación/marca** (white-label, catálogo de La Senda, perímetro social) y no se borra.

## Decisión

1. **El gimnasio de una persona es su única SOCIO `CONFIRMED`** (`ux_affiliations_confirmed_socio`). Ninguna
   ruta toma un id de gimnasio del cliente: lee el gimnasio confirmado de quien pregunta, así que la
   comunidad de otro gimnasio no se puede direccionar. Sin SOCIO confirmada, las rutas del gimnasio
   responden **`403 GYM_MEMBERSHIP_REQUIRED { status: NONE | REQUESTED }`**: es una precondición de función,
   no un recurso ajeno (no hay id que esconder detrás de un `404`).
2. **`GET /me/gym`** da la tarjeta y la pestaña: `status NONE | REQUESTED | CONFIRMED`, el gimnasio confirmado
   (`{id, name, handle, logoUrl}`), sede, `since`, `affiliationId`, la solicitud pendiente («Solicitud
   enviada», o el cambio de gimnasio con `switchesGym`) y `membershipVisible`. Dos sondas de índice único.
3. **Clasificación** (`GET /me/progression/leaderboard`, misma ruta y forma): los SOCIO confirmados del
   gimnasio con puntos, leídos de `ix_affiliations_gym_confirmed` y su progreso por clave primaria. Quien
   oculta su afiliación no aparece (salvo para sí). Un bloqueo sigue ocultando la foto. Una SOCIO terminada
   pierde el acceso en la petición siguiente (no hay caché).
4. **Socios del gimnasio** (`GET /me/gym/members`): la ficha del directorio, solo de quienes tienen el perfil
   social activo y muestran la afiliación.
5. **Sello «Socio de X»** (`gymBadge` en toda ficha del directorio: perfil, Conocer, me gusta, mapa,
   socios): solo una SOCIO `CONFIRMED` de un gimnasio público (`ACTIVE`), de alguien con el perfil social
   activo y `membershipVisible`. Se calcula en la misma consulta de la ficha (un `LEFT JOIN` sobre
   `ux_affiliations_confirmed_socio`); ninguna entrada lo escribe, así que no se puede falsificar. Un
   gimnasio suspendido conserva su comunidad (ADR-0025 §6) pero no se anuncia en el sello.
6. **Privacidad:** interruptor nuevo `social.profile_settings.gym_membership_visible` (por defecto `true`, lo
   que decidió el dueño), `PUT /me/gym/visibility`. Oculta el sello, la lista de socios, la clasificación y el
   motivo `SAME_GYM`; dónde entrena alguien es dato de ubicación.
7. **Conocer:** motivo `SAME_GYM` y una señal más en `affinity` cuando quien mira y el candidato son SOCIO
   confirmados del mismo gimnasio (el candidato mostrándolo). Los socios confirmados del gimnasio de quien
   mira entran al *pool* (fuente nueva, `ix_affiliations_gym_confirmed`, mismo tope) y están dentro del
   perímetro sea cual sea su tenant; `canInteractAcrossTenants` (me gusta, conexión) acepta lo mismo. El resto
   del perímetro no cambia (tenant + consentimiento bilateral entre gimnasios). La consulta sigue siendo una
   sola: el gimnasio de quien mira es un subselect de una fila en `viewer`, el del candidato un `LEFT JOIN` por
   índice único; no hay consultas por candidato desde la aplicación.

## Inventario de lectores del «gimnasio de la persona»

| Lector | Antes | Decisión |
|---|---|---|
| `GET /me/progression/leaderboard` (clasificación) | `usuarios.tenant_id` | **Pasa a la afiliación** (§3) |
| «Tu gimnasio» del móvil (`entities.tenantId === user.tenantId`) | tenant, en el front | **Pasa a la afiliación**: `GET /me/gym` (§2) |
| Directorio de socios del gimnasio | `/me/gym-directory`, tenant | **Pasa a la afiliación**: `GET /me/gym/members` (§4) |
| `/me/gym-directory` y `/me/gym-directory/:userId` | tenant + entre gimnasios | **Queda tenant** como perímetro social de la instalación (lo usan compartir rutinas y la búsqueda de personas); gana `gymBadge` y el perímetro de mismo gimnasio |
| Conocer: *pool*, filtros y motivos (`discovery-ranking.sql.ts`) | tenant + entre gimnasios | Perímetro **queda tenant**; `SAME_GYM`, señal y *pool* **por afiliación** (§7) |
| Me gusta / conexión (`canInteractAcrossTenants`) | entre gimnasios | + mismo gimnasio confirmado (§7) |
| Me gusta y descartes, mapa de personas, vistas de perfil | tenant | **Quedan tenant** (perímetro de instalación); sus fichas ganan `gymBadge` |
| Historias (`viewersOf`), reels | tenant | **Quedan tenant** (instalación); la audiencia social ya no es el tenant |
| Chat de sistema | ya no usaba el tenant | Sin cambio |
| Catálogo de La Senda (niveles, insignias, premios por tenant) | tenant | **Queda tenant** (marca) |
| Retos semanales | personales | Sin cambio: no son del gimnasio. «Ficha en tu sede» lee el acceso físico, que retira 7e |
| Afinidad «misma sede» y filtro `sucursalId` | `facilities.branches` | **Quedan** (legado de sedes; la sede declarada de la afiliación es `entity_locations`) hasta 7e |
| Mapa de gimnasios (`/me/social-map/gyms`) | `facilities.branches` | **Queda** (legado) hasta 7e |
| `/auth/me` | — | Sin sello: el gimnasio propio es `GET /me/gym` |

## Puente legado: sin relleno

**No** se convierten los miembros de un tenant en SOCIO `CONFIRMED` de la ficha GYM sembrada con ese
`entities.tenant_id`:

- confirmar es un acto del gimnasio (compara los 3 dígitos del CI); un relleno daría comunidad y sello sin que
  nadie confirme;
- una SOCIO exige sede: elegir «la primera» o crear una por defecto inventaría un dato que el gimnasio no dio;
- el tenant por defecto agrupa a toda la instalación: el relleno afiliaría a todos a una ficha sembrada;
- una ficha sembrada sin cuenta de negocio no puede ver, confirmar ni terminar a sus socios (ADR-0025 §6).

Quien era del gimnasio por tenant pide la afiliación (correo verificado, sede, 3 dígitos). Lo prueban
`test/gym-community.e2e-spec.ts` (mismo tenant sin afiliación: `NONE` y `403`) y la sonda contra a3c0a5f.

## Consecuencias

- Contrato: `docs/endpoints/endpoints.md` («Gym community») y `openapi.yaml` (tag `GymCommunity`). Cambia la
  respuesta de `/me/progression/leaderboard` para quien no tiene SOCIO confirmada (antes `200`, ahora `403`);
  las fichas ganan `gymBadge` y Conocer `SAME_GYM` (los clientes ignoran códigos desconocidos).
- Rendimiento: comprobado con `EXPLAIN` en e2e (estadísticas frescas, sin *seq scan*) que la clasificación y
  el *pool* de Conocer leen `ix_affiliations_gym_confirmed` y el gimnasio de quien mira
  `ux_affiliations_confirmed_socio`. No se agrega índice.
- Migración `202611201101-gym-membership-visibility` (agrega la columna; `down` la borra). Independiente de
  las tablas de afiliación: no cambia el orden de *rollback* de 7b/8a/8c.
- Riesgos aceptados: la clasificación respeta el interruptor pero no exige perfil social (es la senda, no
  Conocer); un gimnasio suspendido mantiene su comunidad sin sello público.

## A confirmar con el dueño

1. Por defecto el sello se muestra (`membershipVisible: true`). ¿O debería empezar oculto hasta que la
   persona lo active?
2. `/me/gym-directory` sigue siendo el directorio de la instalación (no del gimnasio). ¿Se reduce a socios del
   gimnasio cuando el front tenga su pestaña, o se renombra?
3. ¿Sugerir en `GET /me/gym` (estado `NONE`) la ficha sembrada del tenant como «¿Es tu gimnasio?» para pedir
   la afiliación con un toque? No se hizo: con el tenant por defecto sería la misma ficha para todos.
