# ADR-0025 — Afiliaciones de personas y coaches a la ficha del gimnasio (franja 7b)

Estado: **aceptado**
Fecha: 2026-11-17
Continúa [ADR-0020](./ADR-0020-cuentas-de-negocio-y-tipo-de-cuenta.md) (cuentas de negocio, `@handle`,
`AccountKindGuard`), [ADR-0021](./ADR-0021-kyc-de-negocios-y-aprobacion-automatica.md) (una ficha es pública
cuando el KYC la aprueba) y [ADR-0022](./ADR-0022-publicaciones-y-post-moderacion.md) (sedes declaradas,
`directory.entity_locations`). Lo leerán 7c («Mi gimnasio», sello «Socio de X», Conocer) y 8e (suscripciones).

## Contexto

Decisiones del dueño (16/11/2026): el gimnasio no tiene personal; es **una cuenta de negocio** que solo
gestiona a quienes dicen estar afiliados. REPP modera y verifica todo; el gimnasio no verifica nada más.
Una persona es **SOCIO de un solo gimnasio** y **ENTRENADOR de varios**. El coaching es abierto: también
entran **coaches independientes** con su propia cuenta de negocio (ficha `COACH`), que piden el vínculo por
`@handle` y el gimnasio acepta. Del solicitante, el gimnasio ve **nombre visible, foto principal, sede
declarada, fecha de la solicitud y los últimos 3 dígitos del CI** que la persona escribió; nada más.

Hasta 8d la «pertenencia a un gimnasio» era `usuarios.tenant_id` (un solo tenant por cuenta, NOT NULL). No
sirve para varios gimnasios, ni para un coach negocio, ni para fichas GYM nacidas del alta propia sin tenant.

## Decisión

1. **La afiliación apunta a la ficha** `directory.entities(id)` de tipo GYM (`gym_entity_id`), nunca a
   `usuarios.tenant_id`, que **no se toca**: sus lectores (directorio de socios, chat de sistema, stories,
   clasificación, el móvil «Tu gimnasio») se mueven en 7c.
2. **Tabla `directory.affiliations`** (migración reversible `202611200901-affiliations`):
   - sujeto = persona (`user_id`) **o** coach negocio (`coach_entity_id`), exactamente uno (CHECK); un coach
     negocio solo es `ENTRENADOR`;
   - `kind SOCIO|ENTRENADOR`; `location_id` obligatorio para un SOCIO vivo, opcional para ENTRENADOR;
   - `ci_last3`: exactamente 3 dígitos tal como los escribió la persona (lo que el gimnasio compara); solo
     personas; existe **solo mientras la fila está viva** (REQUESTED o CONFIRMED): al rechazar, cancelar o
     terminar se borra, y el CHECK `ck_affiliations_ci_closed` (migración `202611200901-affiliations-closed-rows`)
     lo garantiza;
   - estado `REQUESTED → CONFIRMED | REJECTED | CANCELLED`, `CONFIRMED → ENDED`; `reason_code` y
     `reason_note`; `changed_by_user_id` (quién hizo el último cambio; nulo = sistema); `requested_at`,
     `confirmed_at`, `closed_at` atados al estado por CHECK; `replaces_affiliation_id` marca el «cambio de
     gimnasio».
   - **La base garantiza** el tipo GYM del gimnasio y COACH del coach (FK compuestas a
     `entities(id, entity_type)` con columnas generadas constantes) y que la sede es **de ese** gimnasio (FK
     compuesta a `entity_locations(id, entity_id)`, `ON DELETE SET NULL (location_id)`).
3. **Índices únicos parciales:** una fila viva (REQUESTED o CONFIRMED) por (sujeto, gimnasio, tipo);
   **un solo SOCIO CONFIRMED por persona en todos los gimnasios** (`ux_affiliations_confirmed_socio`); una
   sola solicitud SOCIO pendiente por persona (`ux_affiliations_requested_socio`). Índices para la bandeja
   (`gym_entity_id, requested_at` sobre REQUESTED), socios y entrenadores (`gym_entity_id, kind,
   confirmed_at DESC` sobre CONFIRMED) y la lista propia de cada sujeto.
4. **Historial append-only `directory.affiliation_history`** escrito por un disparador en cada alta y cada
   cambio de estado (actor = `changed_by_user_id`). Así queda completo también cuando el cierre de cuenta
   cambia filas con su catálogo de `UPDATE`.
5. **Rutas.** Persona `me/affiliations` (solicitar, listar, ver, `cancel` de REQUESTED, `end` de CONFIRMED;
   correo verificado para solicitar). Coach negocio `business/me/gym-links` (mismo ciclo, solo ficha COACH
   publicada). Gimnasio `business/me/affiliations` (`requests`, `members`, `coaches`, ver, `confirm`,
   `reject` y `end` con chips de motivo; `OTHER` exige nota). Otro tipo de negocio → `403
   BUSINESS_TYPE_NOT_ALLOWED`; lo ajeno → `404`; una persona en `business/*` o un negocio en `me/*` → `403
   ACCOUNT_KIND_NOT_ALLOWED`.
6. **Solo un gimnasio público recibe solicitudes** (ficha ACTIVE con cuenta de negocio): uno en borrador,
   pausado, suspendido o inexistente responde `404` igual. Las solicitudes pendientes **solo se leen y se
   deciden mientras el gimnasio es público**: uno que REPP suspendió conserva sus socios y entrenadores, pero
   no ve ni decide datos de gente nueva (`409 GYM_NOT_ACTIVE`).
7. **Cambio de gimnasio.** Si la persona ya es SOCIO confirmado de otro gimnasio, pedir SOCIO responde `409
   SOCIO_OF_ANOTHER_GYM {affiliationId, action: "SWITCH_GYM"}`; con `switchGym: true` la solicitud se crea
   marcada (`replacesAffiliationId`). **La anterior termina solo cuando el nuevo gimnasio confirma**, en la
   misma transacción (`ENDED`, `SWITCHED_GYM`), con aviso a la persona.
8. **Concurrencia.** Toda escritura de un sujeto toma primero su candado (`usuarios` `FOR NO KEY UPDATE`, o
   la ficha del coach) y después la fila (`FOR UPDATE`): el orden es el mismo en solicitar, confirmar,
   rechazar, terminar, cancelar y en el cierre de cuenta (que bloquea la cuenta `FOR UPDATE`). Dos
   confirmaciones a la vez dan `200` y `409 AFFILIATION_INVALID_TRANSITION`; dos solicitudes SOCIO
   simultáneas a dos gimnasios dan `201` y `409`. Los índices únicos son la última palabra.
9. **Anti-spam (constantes en `affiliation.catalog.ts`):** hasta 5 solicitudes pendientes por persona y 10
   por coach negocio (`409 AFFILIATION_LIMIT`); tras un rechazo o un fin decidido por el gimnasio, 7 días sin
   volver a pedirle lo mismo; tras cancelar la propia, 1 día (`409 AFFILIATION_COOLDOWN {retryAfter}`);
   20 solicitudes por hora por cuenta (throttle).
10. **Lo que ve el gimnasio** es un contrato fijado por e2e: `{id, kind, status, subject, location{id,name},
    requestedAt, confirmedAt}`; `subject` de persona = `{type: PERSON, displayName, photoUrl, ciLast3}`
    (`nombre_completo`, primera foto no oculta de `profile.photos`); de coach negocio = `{type: BUSINESS,
    name, handle, logoUrl, badge VERIFIED|NEW}`. Nunca id de usuario, correo, fecha de nacimiento, perfil
    social ni CI completo. Los avisos al gimnasio no nombran a la persona.
    **Minimización de lo cerrado** (revisión de seguridad de a3c0a5f): el gimnasio lee por id solo lo vivo,
    es decir sus socios y entrenadores (CONFIRMED) y las solicitudes (REQUESTED) mientras es público. Una
    fila cerrada (REJECTED, CANCELLED, ENDED) es `404` por id, sea público o no, y ninguna lista la devuelve.
    La respuesta del propio `reject` o `end` trae `subject: null`: la consulta del gimnasio no selecciona
    nombre, foto, dígitos ni tarjeta de coach de una fila cerrada. Lo que el gimnasio necesita de verdad (la
    bandeja, las listas de socios y entrenadores y terminar a uno de ellos) solo toca filas vivas. La persona
    conserva su propia fila cerrada (estado, motivo, fechas), sin los dígitos.
11. **Avisos** in-app (clave `affiliation:{id}:{evento}`): solicitud al gimnasio (de persona o de coach);
    confirmada, rechazada (con motivo) y terminada (también por cambio de gimnasio) a la persona o al coach.
12. **Sedes.** Eliminar una sede que declaró un SOCIO vivo choca con el CHECK de la afiliación y responde `409
    LOCATION_IN_USE`; si ya no hay socios vivos, la afiliación cerrada queda sin sede.
13. **Cierre y exportación.** Cerrar la cuenta de la persona termina lo vivo (`CANCELLED`/`ENDED`,
    `ACCOUNT_CLOSED`), borra los dígitos del CI y anonimiza al actor del historial; como toda fila cerrada,
    deja de ser legible para el gimnasio. La exportación incluye sus afiliaciones y su historial, sin el id de quien decidió.
14. **Moderación.** Para denunciar cómo un gimnasio maneja su afiliación alcanza la denuncia existente
    `BUSINESS_PROFILE` sobre la ficha del gimnasio; no se agrega un tipo nuevo.

## Ganchos para fases siguientes

- **7c** lee el gimnasio de una persona con `AffiliationsRepository.findCurrentSocio(userId)`: `WHERE user_id
  = :userId AND kind = 'SOCIO' AND status = 'CONFIRMED'`, una sola sonda sobre
  `ux_affiliations_confirmed_socio`. El conteo por gimnasio usa `ix_affiliations_gym_confirmed`.
- **8e** confirma la SOCIO junto con la orden que paga la suscripción llamando a
  `GymAffiliationsService.confirmInTransaction(gymEntityId, affiliationId, actorUserId, transaction)` dentro
  de su propia transacción (el llamador acota el gimnasio). El periodo de suscripción podrá referenciar
  `directory.affiliations(id)`.

## Consecuencias

- Contrato nuevo en `docs/endpoints/endpoints.md` y `openapi.yaml`. No cambia ninguna ruta existente salvo
  `DELETE business/me/locations/:id`, que gana el `409 LOCATION_IN_USE`.
- Riesgos aceptados: `ci_last3` es lo que la persona escribe (nadie lo verifica: el gimnasio compara); el
  nombre visible es `nombre_completo`; un gimnasio pausado no recibe ni decide solicitudes hasta volver.
  Lo que pasa con las afiliaciones cuando **cierra el gimnasio** llega con el cierre de negocios (8f).
- Rollback: el down de `202611200901-affiliations-closed-rows` quita el CHECK; los dígitos que borró no
  vuelven (se borraron a propósito). El de `202611200901-affiliations` borra las dos tablas (sus datos se pierden: nada anterior los lee), el
  disparador y los dos índices de apoyo. El down de las migraciones de 8a y 8c en sus e2e baja primero esta.
