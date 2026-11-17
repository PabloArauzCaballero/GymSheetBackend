# ADR-0020 — Cuentas de negocio y tipo de cuenta (franja 8a)

Estado: **aceptado**
Fecha: 2026-11-16
Continúa [ADR-0019](./ADR-0019-repp-opera-la-plataforma.md) (REPP opera la plataforma). Absorbe la
«7c — cuentas de negocio» que ADR-0019 dejó anunciada.

## Contexto

Decisión del dueño (16/11/2026): todo actor del marketplace —gimnasio, centro, tienda, coach,
proveedor de servicios— tiene **su propia cuenta de negocio**, con **un solo acceso**, sin datos de
persona; los coaches son **abiertos** (cuentas de negocio `COACH` independientes, además de los
entrenadores que son personas); todo negocio tiene un **@handle público**; la aceptación legal es
en la app. El KYC (8b), las publicaciones (8c), los pedidos (8d) y la afiliación (8e) vienen después.

Hasta hoy cualquier persona creaba una ficha `ACTIVE` del directorio con `is_verified` y `tenant_id`
puestos por ella (D1), y `RolesGuard` deja pasar a cualquier autenticado a toda ruta sin `@Roles`:
una cuenta de otro tipo habría entrado a perfil, social y Conocer.

## Decisión

1. **Rol `NEGOCIO`** (`UserRole.BUSINESS`), uno para los cinco tipos. La base lo garantiza sin datos
   de persona: `ck_usuarios_business_no_person_data` (`fecha_nacimiento` y `genero` nulos). El nombre
   comercial vive en `nombre_completo` (no es dato personal). `tenant_id` = `DEFAULT_TENANT_ID` solo
   para cumplir el `NOT NULL`; no se usa.
2. **`business.accounts`** (esquema nuevo): `user_id` PK ↔ `entity_id` único, **1:1** con una ficha
   `directory.entities` creada en el alta en **`DRAFT`** (no pública) y con `user_id` = la cuenta.
   `entity_type` es copia inmutable; `legal_kind` lo fija el tipo (GYM/CENTER/STORE → `COMPANY`,
   COACH → `INDIVIDUAL`, SERVICE_PROVIDER elige; CHECK en base); `status`
   `ONBOARDING|ACTIVE|SUSPENDED|CLOSED`; `kyc_status` con los estados del §2.5 del plan (en 8a
   siempre `DRAFT`). Una ficha `DRAFT`/`CLOSED` puede no tener categoría ni descripción todavía; una
   pública, no (`ck_directory_entity_public_category`). `entities.status` admite `CLOSED`.
3. **Principal y `/auth/me`** ganan `accountKind` (`PERSON|BUSINESS`, derivado del rol que se relee
   de la base en cada petición) y `businessEntityId` (una consulta por PK, solo para negocios). Las
   respuestas de sesión (`user`) ganan `accountKind`.
4. **`AccountKindGuard`** global, justo después de `JwtAuthGuard`: **deny-by-default para
   `BUSINESS`**. Prefijos permitidos: `auth/` (salvo `auth/socket-ticket`), `legal/`, `me/legal/`,
   `me/devices/`, `health/`, `business/`, `public/`, `notifications/me*`, `notifications/:id/read`,
   `notifications/preferences/me`, `notifications/push/*`, `notifications/device-tokens`. Una persona
   nunca entra a `business/*`. Ambos rechazos son de función (BFLA): `403 ACCOUNT_KIND_NOT_ALLOWED`; el
   acceso horizontal sigue en `404`. Todo `business/*` no público lleva además `@Roles(BUSINESS)`.
   `src/common/guards/account-kind.route-inventory.spec.ts` descubre todas las rutas desde los
   metadatos de Nest y falla si el conjunto que un negocio alcanza deja de ser exactamente la lista
   decidida. **Fuera en 8a** (llegan en 8f con su diseño): chat con personas (`me/conversations`,
   socket), cierre y exportación (`me/account`, `me/export`) y cambio de correo. El cierre
   administrativo de personal (`POST /admin/users/:id/close`) rechaza una cuenta de negocio
   (`400 STAFF_CLOSURE_NOT_STAFF`).
5. **Personas solo personas.** Las consultas que listan personas filtran `rol <> 'NEGOCIO'`
   (`personAccountSql`): directorio del gimnasio y perfil (`me/gym-directory*`), pool de Conocer, la
   clasificación (`me/progression/leaderboard`); pedir conexión o actuar sobre una cuenta de negocio
   responde `404`. Mapa y descubrimiento entre gimnasios ya la excluyen por la edad (fecha nula,
   garantizada por el CHECK).
6. **Legal por tipo de cuenta.** Documentos nuevos `BUSINESS_TERMS` y `BUSINESS_DPA`, versionados y
   con SHA-256 calculado del archivo (`docs/legal/negocios/*.md`; una prueba recalcula el hash). Conjunto
   PERSON = TERMS, PRIVACY, COMMUNITY; BUSINESS = BUSINESS_TERMS, BUSINESS_DPA, PRIVACY (que la
   privacidad cubra a los representantes lo decide el abogado). `LegalAcceptanceGuard`, `pending` y
   `accept` usan el conjunto del tipo; aceptar un documento del otro conjunto es
   `422 LEGAL_DOCUMENT_NOT_APPLICABLE`. `GET /legal/current?accountKind=BUSINESS` publica el conjunto.
   **Los textos actuales son borradores** («BORRADOR — no publicar», redactados aparte con
   `legal-bolivia` y revisados por `legal-reviewer`).
7. **Alta `POST /business/signup`** (pública): mismo antibot (boleto de `GET /auth/register/ticket`,
   honeypot, Turnstile/attestation, límites, correo desechable), evidencia legal del conjunto de
   negocio, PIN de correo, herencia de sanciones de cuentas cerradas y emisión de sesión, todo en una
   transacción. Sin fecha de nacimiento, sexo, onboarding ni Conocer. Pide `businessName` (también es
   el nombre de la cuenta: evita una ficha sin nombre).
8. **Puerta `BUSINESS_SIGNUP_ENABLED`** (por defecto `false`). Cerrada responde
   **`404 BUSINESS_SIGNUP_DISABLED`**: la ruta es pública y no hay identidad que autorizar (un `403`
   diría «tú no», cuando es «esto no existe todavía»); el código estable deja al cliente mostrar
   «próximamente». En producción el alta sigue cerrada aunque la variable esté activa mientras
   `BUSINESS_LEGAL_TEXTS_ARE_DRAFTS` sea `true`.
9. **@handle** (`directory.handles`, `directory.handle_changes` append-only): 3–30 de `[a-z0-9._]`,
   empieza y termina en alfanumérico, sin separadores dobles, no solo dígitos (CHECK en base);
   entrada normalizada (trim, sin `@`, NFKC, minúsculas, solo ASCII). `skeleton` sin `.`/`_` y con
   confundibles plegados (`0→o 1→l i→l 5→s 3→e`, y los pares `rn→m vv→w`); índice único parcial por skeleton sobre
   `PENDING|ACTIVE|RESERVED` y, para lo que no cabe en el índice (retirados bloqueados, reservas
   vencidas), `pg_advisory_xact_lock` por skeleton. Reservadas en código (comparadas por skeleton,
   y `repp` en cualquier posición) más filas `RESERVED` de REPP. Mientras la ficha es `DRAFT` el
   handle es una **reserva `PENDING`** (no pública, cambiable libremente). La reserva vence a los
   **14 días contados desde la creación de la ficha** (`directory.entities.created_at`): un inicio
   fijo que ni volver a pedir el mismo handle ni cambiarlo por otro mueven, así que nadie acapara un
   nombre sin terminar el KYC. Vencida, el handle queda libre para otro (se borra al reclamarlo) y la
   ficha no reserva ninguno más mientras siga `DRAFT` (`409 HANDLE_RESERVATION_EXPIRED`); el envío del
   KYC (8b) es el que la saca de `DRAFT`. **Pasa a `ACTIVE` con la aprobación del KYC (8b)**: en 8a ningún handle ni ficha llega
   a público y **no se añade** ningún atajo de activación. Renombre (solo ficha `ACTIVE`): 1 cada 30
   días y 3 por año (`429 HANDLE_RENAME_LIMIT`); el viejo queda `RETIRED` con redirección 90 días y
   bloqueado 180.
10. **El nombre comercial y la categoría son materiales.** El nombre (en el alta y en
    `PATCH /business/me/profile`) pasa por NFKC y las mismas comprobaciones que un handle: lista de
    caracteres permitidos — letras que sin tilde quedan en `a-z` (`ñ`, `á`, `ü`), dígitos ASCII, espacio
    y `& ' ’ . , - ·`; cualquier otro (cirílico, griego, dígitos no ASCII, símbolos) responde
    `422 BUSINESS_NAME_INVALID` en vez de borrarse del skeleton —, palabras reservadas
    y `repp` en cualquier posición, filas `RESERVED` de REPP (`422 BUSINESS_NAME_RESERVED`) y mismo
    skeleton que una ficha `ACTIVE` del mismo tipo (`422 BUSINESS_NAME_TOO_SIMILAR`). El skeleton se
    pliega **solo en la aplicación** (`businessNameSkeleton`: sin tildes, sin espacios ni signos, y el
    pliegue del handle `0→o 1→l i→l 5→s 3→e rn→m vv→w`) y se guarda en
    `directory.entities.name_skeleton` (hook del modelo al crear y renombrar; migración 202611200403
    con relleno e índice parcial sobre las fichas `ACTIVE`), así JS y SQL no pueden divergir. Mientras la ficha es `DRAFT` nombre y
    categoría cambian con esas comprobaciones; **pasado `DRAFT`, cambiar cualquiera de los dos responde
    `409 BUSINESS_MATERIAL_CHANGE_REQUIRES_REVIEW`** y nada se publica (reenviar el valor actual no es
    un cambio). Lo que lo acepta es el versionado del KYC de la franja 8b (cambio material → versión
    nueva en revisión, la vigente sigue publicada; plan §2.5), que también suma la similitud por
    trigramas (≥ 0,8 → `IN_REVIEW`, plan §2.2): en 8a el skeleton rechaza en el acto y la revisión
    humana no existe todavía.
11. **Medios del negocio** (logo y portada) en `business/{entityId}/public/…`: públicos (política
    anónima de MinIO) y **borrables** como el contenido de una persona (ADR-0017): reemplazar o quitar
    encola el borrado en `media.release` cuando ninguna fila lo referencia (`directory.entities`
    `logo_url`/`cover_url` entran en el recuento). El bootstrap de MinIO concede borrar y listar
    versiones bajo `business/*/public/*`.
12. **Directorio:** `POST /directory/entities` pasa a `SYSTEM_ADMIN` (semillas de REPP), sin
    `is_verified`, `tenant_id` ni dueño en el cuerpo (D1; cuerpo estricto). Se corrigen D2 (pinned:
    ya cerrado en 7a), D3, D4, D5, D7, D8 y D12 (ver el plan de auditoría).

## Continuación en 8b

[ADR-0021](./ADR-0021-kyc-de-negocios-y-aprobacion-automatica.md) completa lo que aquí quedó
anunciado: la ficha y el handle pasan a `ACTIVE` sólo por la máquina del KYC
(`AUTO_APPROVED`/`APPROVED`); el `409 BUSINESS_MATERIAL_CHANGE_REQUIRES_REVIEW` del §10 lleva ahora
`details.action = "POST /business/me/kyc/changes"`, la versión nueva que lo acepta; y la reserva
`PENDING` deja de vencer por los 14 días una vez que el negocio envió su KYC (está esperando a REPP
o reenviando, no acaparando). Mientras el KYC está `SUBMITTED`/`IN_REVIEW`, ni el handle ni el
nombre ni la categoría cambian (`409 KYC_NOT_EDITABLE`).

## Sedes

`directory.entity_locations` queda para la franja 8c (perfil público, sedes y publicaciones): no hace
falta para el alta ni para el handle.
Llegó con [ADR-0022](./ADR-0022-publicaciones-y-post-moderacion.md), junto con las publicaciones y el
perfil público por @handle.

## Consecuencias

- Contrato público que cambia: `POST /directory/entities` (403 a no `SYSTEM_ADMIN`; nadie lo usa en el
  frontend), `GET /public/directory/entities/:id/payment-config` (sin `taxId`, `id`, `entityId` ni
  fechas; `null` si el cobro está inactivo; `404` si la ficha no es pública),
  `GET /public/directory/plans/:id` y `/entities/:id/plans` (mapeados; `404` si plan o ficha no están
  activos). El esquema del frontend que exige `taxId` debe volverlo opcional.
- Rollback: `yarn migration:down` convierte cada `NEGOCIO` en `CLIENTE` `INACTIVO` cerrado (no inicia
  sesión), borra sus fichas `DRAFT`, las tablas y las aceptaciones de los documentos de negocio, y
  restaura los CHECK y los valores por defecto (`CLOSED` → `SUSPENDED`).
