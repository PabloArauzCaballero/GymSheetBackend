# PLAN — Portal Admin v2: Archivos (MinIO), Moderación, Soporte, Usuarios y Consola de Sistema

Fecha: 2026-09-13 (F1 entregada el 2026-09-14) · Rama base: `dev` (ambos repos)
Estado: **F1 y F4 implementadas y verificadas · F2, F3, F5–F8 propuestas**
Copia idéntica en `GymSheetBackend/docs/plan/` y `GymSheetFrontend/docs/plan/`.
Plan predecesor: portal admin 8 fases (`~/.claude/plans/vivid-soaring-parrot.md`) — de él
solo se ejecutó la **Fase 0 (RBAC granular)**; este plan v2 la reutiliza como cimiento y
absorbe su fase de Google Analytics dentro de F7.

---

## 1. Estado verificado (auditoría del código, 2026-09-13)

### 1.1 Lo que YA existe y este plan reutiliza

| Capacidad | Evidencia | Estado |
|---|---|---|
| RBAC granular aditivo | `src/modules/admin-access/` (PermissionGuard, `@RequirePermission()`, catálogo estático con dominios `catalog/qa/data-loader/analytics/artifacts/admin-access`), migración `202609010001-admin-permissions`, seed `admin-permissions.seed.ts`, UI `/admin/permissions` | ✅ Fase 0 completa |
| Rol `SYSTEM_ADMIN` | `src/common/enums/domain.enums.ts` (supra-tenant, documentado), migración `202608290001-tenants-and-system-admin`, `GET /admin/tenants` gateado `@Roles(SYSTEM_ADMIN)` | ✅ backend / ❌ **no existe en frontend** (`packages/types/src/enums.ts` no lo incluye) |
| Adaptador MinIO inmutable | `src/modules/media/adapters/minio-storage.adapter.ts` (ADR-0010): claves `users/{userId}/{categoría}/{sha256}.{ext}` + `catalog/`, `remove()` no-op, bucket versionado, env `MINIO_*` | ✅ adaptador; ⚠️ VPS: plan `PLAN-MINIO-MEDIA.md` en estado *propuesto*, llave SSH pública sin instalar |
| Puerto de storage | `media-storage.port.ts`: **solo `upload` y `remove`** — no hay `list`, `stat` ni descarga | ⚠️ hay que extenderlo para el Drive |
| Refcount de binarios | `media-references.repository.ts` — mapea TODAS las tablas que referencian claves (`profile.stories`, `profile.photos`, `chat.messages`, `media.files`, `training.exercise_media`, `facilities.branches`) | ✅ base perfecta para "referenciado por" del Drive |
| Chat de soporte embrión | `src/modules/chat/system-chat.service.ts`: conversaciones fijas por usuario con la cuenta corporativa (`SEED_SYSTEM_CORPORATE_EMAIL`) y con el ADMIN del tenant; gateway websocket operativo; UI de chat web en `(portal)/chat` | ✅ transporte; ❌ sin inbox admin, sin tickets, sin estados |
| Gestión de personas | `membership.controller.ts` (`/admin/membership/*`): customers, staff, `PATCH staff/:userId/status`, memberships; `/admin/membership/users` (lista, `q`, **limit fijo 200**) | ⚠️ parcial: no hay detalle de usuario, ni reset de contraseña, ni revocar sesiones, ni cambio de rol |
| Sesiones/credenciales | `auth/`: refresh tokens con `revoke`/`revokeFamily`, `password-reset.service.ts`, hash de tokens | ✅ reutilizable desde admin |
| Estado de usuario | `UserStatus = ACTIVO \| INACTIVO` en `usuarios.estado` | ⚠️ sin noción de suspensión temporal (moderación) |
| Notificaciones | `notifications/`: device tokens (migración `202609131200`), push Expo, broadcast `POST /admin/notifications/broadcast` (`@Roles(ADMIN)`), preferencias, delivery attempts | ✅; ⚠️ Web Push/VAPID pendiente (PLAN-PARIDAD-WEB H1) |
| Observabilidad base | `health/`: `/health/live`, `/ready`, `/metrics` Prometheus (contadores/histogramas HTTP acotados, pool Sequelize, memoria) + `metrics-scrape.guard` | ✅ para scrapear; ❌ sin dashboards, sin alertas, sin logs centralizados, sin error tracking |
| Métricas HTTP en proceso | `src/common/metrics/http-metrics.service.ts` (registro acotado a 250 series) | ✅ fuente del resumen in-app |
| Outbox transaccional | `integration/` + `workers/outbox-prune.command.ts` (patrón de workers ya establecido) | ✅ para GA4 opcional y rollups |
| Portal admin web | 9 páginas en `(portal)/admin/*` (overview, equipment, exercises, facilities, membership, access, permissions, usuarios, operacion, people); nav en `shared/components/layout/nav-config.ts`; layout gate `requireRole(['ADMIN','FRONT_DESK'])`; sesión ya trae `permissions` (staff) | ✅ chasis |
| Multi-tenant | `tenants/` (`GET /admin/tenants` solo SYSTEM_ADMIN, sin UI), `usuarios.tenant_id NOT NULL` | ✅ modelo; ❌ sin consola |

### 1.2 Lo que NO existe (los cinco encargos)

1. **Explorador de archivos MinIO (Drive)** — nada. Ni listado en el puerto, ni endpoints, ni UI.
2. **Motor de moderación** — nada. Cero reportes, cero flags de contenido, sin bloqueo entre usuarios (solo *passes* de descubrimiento), sin suspensiones.
3. **Motor de soporte** — solo el transporte (chats de sistema). Sin tickets, estados, asignación, inbox ni métricas.
4. **Gestión de usuarios completa** — `/admin/usuarios` es una tabla de solo lectura.
5. **Consola SYSTEM_ADMIN (webtracking + monitoreo)** — el rol no existe en el frontend; no hay ninguna ruta, tracking de producto (solo llaves `analytics:*` sembradas sin módulo detrás) ni panel de sistema.

### 1.3 Defectos puntuales a corregir (verificados)

| # | Defecto | Dónde |
|---|---|---|
| C1 | El grid del overview lista 6 módulos pero la nav lista más (`/admin/usuarios`, `/admin/operacion`, `/admin/people`): dos fuentes de verdad divergentes | `admin-overview.tsx` vs `nav-config.ts` |
| C2 | `/admin/membership/users` con `limit=200` fijo, sin paginación de servidor | `insights-service.ts` + `membership.controller.ts` |
| C3 | `userRoles` del frontend no incluye `SYSTEM_ADMIN` → una sesión de ese rol no es representable | `packages/types/src/enums.ts`, `packages/domain/src/permissions.ts` |
| C4 | Los módulos admin existentes no usan permisos granulares (solo el panel de permisos los usa) | controllers backend + grid |
| C5 | `/admin/tenants` sin consumidor (UI) | — |
| C6 | Sin registro de auditoría de acciones administrativas (solo los grants guardan `grantedBy`) | transversal |

---

## 2. Decisiones de arquitectura

- **D1 — Dos consolas, un portal.** `(portal)/admin/*` sigue siendo la consola del gimnasio (ADMIN/FRONT_DESK, siempre tenant-scoped). Se añade `(portal)/sistema/*` para `SYSTEM_ADMIN` (supra-tenant), compartiendo el `portal-shell` y el design system pero con nav propia. El backend gatea con `@Roles(SYSTEM_ADMIN)` (piso) y las rutas nuevas de gimnasio con `@Roles(ADMIN[, FRONT_DESK])` + `@RequirePermission(...)` (aditivo), igual que la Fase 0.
- **D2 — La inmutabilidad de MinIO es ley.** El Drive **no borra objetos jamás** (coherente con ADR-0010: `remove()` no-op, credenciales sin `DeleteObject`, bucket versionado). Moderar = ocultar la **fila** que referencia el binario, nunca el binario. La UI lo comunica explícitamente ("el archivo se conserva; deja de servirse").
- **D3 — Tenancy de archivos por dueño, no por clave.** Las claves MinIO no llevan tenant. El Drive resuelve el dueño desde el prefijo `users/{userId}/…` y lo cruza con `usuarios.tenant_id`. Un ADMIN ve solo objetos de usuarios de su tenant (+ `catalog/`); `SYSTEM_ADMIN` ve todo el bucket.
- **D4 — Extender el puerto, no saltárselo.** `list/stat/stream` entran al puerto `MediaStorageProvider` y los implementan **ambos** adaptadores (local con `fs`, MinIO con `listObjectsV2/statObject/getObject`), para que el Drive funcione idéntico en dev y producción — misma razón por la que `mediaTargetPrefix` vive en el puerto.
- **D5 — Auditoría transversal primero.** Toda acción administrativa nueva (moderar, suspender, responder soporte, descargar archivo, cambiar rol) escribe en `admin.audit_log` desde F1. La consola de sistema lo lee completo; la de gimnasio, filtrado a su tenant.
- **D6 — Webtracking first-party como fuente primaria.** Los dashboards in-app necesitan datos consultables: eventos en Postgres (`analytics.events` + rollups diarios) con taxonomía gobernada (las llaves `analytics:read/admin` ya sembradas por fin gatean algo). GA4 vía outbox queda como **dual-write opcional** (retoma la fase GA del plan v1 sin bloquear nada).
- **D7 — Monitoreo en dos capas.** (a) *In-app*: panel de sistema que resume lo que el proceso ya sabe (`HttpMetricsService`, health, pool, backlog de outbox, fallos de delivery, ping MinIO). (b) *Infra*: Prometheus + Grafana + Loki como servicios Coolify en el VPS scrapeando `/health/metrics` (protegido por `metrics-scrape.guard`), con Alertmanager. La capa (a) no depende de la (b).
- **D8 — Soporte = tickets sobre las conversaciones existentes.** No se inventa otro canal: `support.tickets` referencia `chat.conversations` (las de sistema). El realtime, receipts y media ya funcionan; el motor añade estado, asignación, notas internas y métricas.
- **D9 — Sin nuevos valores de rol.** Igual que la Fase 0: los cinco encargos se gatean con roles existentes + permisos granulares nuevos. `SYSTEM_ADMIN` ya existe; solo se le da superficie.

---

## 3. Catálogo de permisos ampliado (F1)

Nuevas entradas en `admin-permission.catalog.ts` (mismo patrón estático; el seed idempotente ya se encarga):

| Key | Dominio nuevo | Gatea |
|---|---|---|
| `files:read` | `files` | Ver el Drive (árbol, stats, referencias) |
| `files:download` | `files` | Descargar el binario original |
| `moderation:read` | `moderation` | Ver cola de reportes e historial |
| `moderation:act` | `moderation` | Resolver reportes: ocultar, advertir, suspender |
| `support:read` | `support` | Ver inbox de tickets |
| `support:respond` | `support` | Responder, asignar, cerrar tickets |
| `users:read` | `users` | Ver detalle completo de usuario |
| `users:manage` | `users` | Activar/desactivar, reset de contraseña, revocar sesiones |
| `users:danger` | `users` | Cambiar rol, anonimizar/borrar cuenta |
| `system:read` | `system` | (informativo para SYSTEM_ADMIN; el piso real es el rol) |

`SYSTEM_ADMIN` no depende de grants: sus controllers se gatean por rol (D9). El seed otorga el set completo nuevo al admin bootstrap, como hoy.

---

## 4. F1 — Cimientos y correcciones (prerequisito de todo) — **IMPLEMENTADA (2026-09-14)**

> **Estado real de la entrega.** Lo ejecutado difiere del boceto de abajo en cinco puntos,
> todos verificados contra una base de datos y una API reales:
>
> 1. **Un solo endpoint de auditoría, no dos.** `GET /admin/audit` resuelve el alcance desde
>    `actor.tenantScope`, igual que el resto de los módulos administrativos. `/admin/system/audit`
>    habría sido una segunda ruta con la misma consulta detrás.
> 2. **`PermissionGuard` ahora deja pasar a `SYSTEM_ADMIN` por rol.** Sin eso el rol era
>    incoherente consigo mismo: `RolesGuard` lo dejaba entrar y `PermissionGuard` lo rechazaba en la
>    misma ruta, así que la consola de sistema sólo habría funcionado concediéndole a mano las 21
>    llaves del catálogo — y cada llave futura. `/admin/permissions/me` acompaña el cambio y devuelve
>    los permisos EFECTIVOS (el catálogo completo para ese rol), para que el portal no esconda
>    botones que la API sí permite.
> 3. **`system:read` no se creó.** Con el punto anterior la llave no gatearía nada.
> 4. **Agujero de aislamiento encontrado y cerrado (no estaba en el plan).** El endurecimiento H-02
>    acotó por gimnasio `MembershipRepository`, pero `GymInsightsService` quedó fuera: sus cuatro
>    informes —`listUsers`, `lapsedMembers`, `equipmentUsage`, `peopleFlow`— respondían sobre la
>    plataforma entera, de modo que un `ADMIN` leía nombre, correo y teléfono de las cuentas de otros
>    gimnasios en `/admin/membership/users`. Los cuatro reciben ahora `tenantScope`.
>    Verificado en vivo: el ADMIN de `topfitness` ve 10 cuentas de su gimnasio; el `SYSTEM_ADMIN`, 12
>    repartidas en tres.
> 5. **Frontend, dos hallazgos extra.** `/dashboard` redirige a `/sistema` para ese rol (era el
>    destino por defecto de login, registro y `?denied=1`, y es una pantalla de socio); y `sistema`
>    tuvo que registrarse en `knownRoutes` del proxy, que si no la habría tomado por el prefijo de un
>    gimnasio — lo detectó el test de guardia `proxy.test.ts`.
>
> **Correcciones posteriores (2026-09-14, misma entrega).** Una revisión del propio F1 encontró tres
> defectos introducidos por él y dos preexistentes, todos corregidos:
>
> - **Regresión propia:** al paginar `/admin/membership/users` (50 por página en vez de 200 sueltos),
>   el panel de permisos —que pedía todas las cuentas y se quedaba con el personal en el navegador—
>   dejó de encontrar al personal que no cupiera en la primera página. Se añadió el filtro
>   `?roles=` al endpoint: **filtra la consulta, no el navegador**. Los roles viajan como una sola
>   cadena partida con `string_to_array`, validada contra el enum (rol inventado → 400; intento de
>   inyección → 400).
> - **Coste propio:** el redirect de `SYSTEM_ADMIN` en `/dashboard` añadía una segunda resolución de
>   sesión sobre la del layout. `getSession` pasa a estar memoizada con `cache()` de React (ámbito de
>   una petición), lo que además elimina el doble/triple round-trip preexistente en las ~40 páginas
>   que ya llamaban a `requireRole`/`requireSession` bajo el layout del portal.
> - **Dos defectos menores de UI propios:** «1 cuenta coinciden» (concordancia) y un estado vacío que
>   decía «todavía no hay actividad registrada» cuando lo que había era un filtro sin resultados.
> - **Preexistente:** `stories.repository.integration.spec.ts` daba por sembrado el gimnasio
>   `megatlon`, que no existe en una base recién migrada, y violaba la clave foránea
>   `usuarios.tenant_id → tenants`. Ahora lo siembra dentro de su propia transacción.
>
> **Evidencia ejecutada:** migración aplicada y revertida contra PostgreSQL 16 real (tabla e índices
> inspeccionados con `\d`); seed sembrando las 21 llaves en 10 dominios; API arrancada y ejercitada
> con tokens reales de `ADMIN` y `SYSTEM_ADMIN` — auditoría escrita en acciones 2xx, **cero filas**
> ante dos rechazos 404, fila de plataforma (`tenant_scope` nulo) invisible para el gimnasio,
> paginación keyset recorrida sin duplicados, `pageSize=999` → 400, cursor corrupto → 200, filtro de
> roles devolviendo 3 de 11 cuentas.
> Puertas finales: backend **570 tests en 83 suites contra PostgreSQL real, sin saltarse ninguna**,
> más lint / type-check / build; frontend 195 tests / lint / type-check / build, con
> `/admin/auditoria`, `/sistema` y `/sistema/auditoria` presentes; **`apps/mobile` type-check en
> verde** (una afirmación anterior de esta misma sección decía que fallaba por dependencias sin
> instalar: era un diagnóstico equivocado — están en `apps/mobile/node_modules` y compila).

### Boceto original


### Backend
1. **Migración `202609150001-admin-audit-log.ts`** — tabla `admin.audit_log`:
   `id uuid PK, occurred_at timestamptz, actor_user_id uuid, actor_role text, tenant_id uuid NULL, domain text, action text, target_kind text NULL, target_id text NULL, metadata jsonb NOT NULL DEFAULT '{}', ip inet NULL, user_agent text NULL` + índices `(occurred_at DESC)`, `(actor_user_id)`, `(tenant_id, occurred_at DESC)`, `(domain, action)`.
2. `src/modules/admin-access/audit-log.{model,service}.ts` + decorador `@Audited(domain, action)` (interceptor Nest que persiste tras respuesta 2xx, con `targetId` extraído de params). Los controllers nuevos de F2–F7 lo usan; los existentes de membership/access se anotan oportunistamente.
3. Catálogo de permisos ampliado (§3) — solo código + seed, sin migración (la tabla ya upserta).
4. `GET /admin/audit` (`@RequirePermission('admin-access:manage')`, tenant-scoped) y `GET /admin/system/audit` (SYSTEM_ADMIN, global) con filtros `actor`, `domain`, `from/to`, paginación keyset.
5. **C2**: `/admin/membership/users` acepta `page/cursor` + `limit≤100` real y devuelve `total`.

### Frontend
6. **C3**: añadir `SYSTEM_ADMIN` a `packages/types/src/enums.ts`; en `packages/domain/src/permissions.ts` añadir `isSystemAdmin()` y excluirlo de `isStaff` de gimnasio (no debe ver módulos tenant); verificar que `(portal)/layout.tsx` y el flujo de login no revientan con el rol nuevo y que la sesión de `SYSTEM_ADMIN` **no** llama `/admin/permissions/me` (o tolera 403).
7. Grupo de rutas `(portal)/sistema/` con `layout.tsx` → `requireRole(['SYSTEM_ADMIN'])` y página placeholder; `systemNavigation` en `nav-config.ts`.
8. **C1**: el grid de `admin-overview.tsx` se deriva de `nav-config.ts` (una sola fuente de verdad, con descripción e icono ahí).
9. `/admin/usuarios` consume la paginación nueva.

### Verificación F1
- Unit: interceptor de auditoría (escribe en 2xx, no escribe en 4xx/5xx), catálogo sembrado, guards.
- Manual: login con usuario `SYSTEM_ADMIN` sembrado → aterriza en `/sistema`, no ve `/admin/*` de gimnasio; auditoría visible con filtros.

---

## 5. F2 — Archivos: Drive sobre MinIO

### Backend
1. **Puerto** (`media-storage.port.ts`): añadir

   ```ts
   interface StorageObjectStat { key; sizeBytes; lastModified; contentType?; checksumSha256? }
   interface StorageListPage { objects: StorageObjectStat[]; prefixes: string[]; nextCursor?: string }
   list(prefix: string, opts: { cursor?: string; limit: number; delimiter?: "/" }): Promise<StorageListPage>
   stat(key: string): Promise<StorageObjectStat | null>
   createReadStream(key: string): Promise<Readable>
   ```

   Implementación MinIO: `listObjectsV2` (con `startAfter` como cursor, `delimiter: '/'` para carpetas virtuales), `statObject`, `getObject`. Implementación local: `fs.readdir/stat/createReadStream` bajo `MEDIA_STORAGE_LOCAL_ROOT` (mismas claves → mismo árbol). Specs espejo de los actuales.
2. **Módulo nuevo `src/modules/admin-files/`** (controller + service + mapper + schemas):
   - `GET /admin/files/tree?prefix&cursor&limit` — carpetas + objetos del nivel; para prefijos `users/{userId}/…` resuelve dueño (nombre, rol, tenant) en lote. **Scope**: ADMIN solo ve `users/*` cuyo dueño pertenece a su tenant, más `catalog/`; SYSTEM_ADMIN todo.
   - `GET /admin/files/object?key` — stat + dueño + `references[]` (vía `MediaReferencesRepository`: en qué story/foto/mensaje/sede/ejercicio vive) + estado `huérfano` si nadie lo referencia.
   - `GET /admin/files/object/content?key` — stream con `Content-Disposition` (descarga) o inline para preview; `@RequirePermission('files:download')` para el modo descarga; **auditado** (D5).
   - `GET /admin/files/usage?groupBy=category|user|tenant&prefix` — agregado de tamaño/conteo. Se calcula con un walk paginado **cacheado** (TTL 10 min en memoria) para no castigar MinIO en cada render.
   - Guards: `@Roles(ADMIN)` + `@RequirePermission('files:read')`; los mismos endpoints sirven a `/sistema` (el service decide scope por rol).
3. Migración: ninguna (todo se deriva de MinIO + tablas existentes).

### Frontend (`/admin/archivos` y `/sistema/archivos`, mismo feature)
4. `features/admin/files/`:
   - **Vista Drive**: breadcrumbs por prefijo, toggle grid/lista, iconos por MIME, thumbnails para imagen/vídeo (URL pública para `perfiles`; endpoint `content` inline para lo privado), orden por nombre/fecha/tamaño, paginación "cargar más" (cursor).
   - **Drawer de detalle**: preview grande, metadatos (tamaño, SHA-256, MIME, fecha, dueño con link a su ficha F3), **"Referenciado por"** (chips → story/foto/mensaje/sede) y aviso de inmutabilidad (D2). Botón Descargar (si `files:download`).
   - **Cabecera de uso**: tarjetas de totales por categoría (`perfiles/stories/chats/catalog`) y top usuarios por consumo.
   - Búsqueda por usuario (autocomplete sobre `/admin/membership/users`) que salta al prefijo `users/{id}/`.
   - Diseño bajo `apple-premium-ui` (contención, jerarquía, acento volt solo en acción primaria).

### Verificación F2
- Unit: list/stat/stream en ambos adaptadores; scope por tenant (ADMIN no ve claves de otro tenant: **404, no 403** — no filtrar existencia).
- Manual: subir foto de perfil y story en dev (provider local) → aparecen en el árbol con referencias correctas; con `MEDIA_STORAGE_PROVIDER=minio` contra el VPS, mismo árbol.
- **Prerequisito infra**: MinIO del VPS operativo (PLAN-MINIO-MEDIA aún *propuesto*; instalar llave SSH primero). El Drive funciona en dev sin él.

---

## 6. F3 — Gestión de usuarios (consola de gimnasio)

### Backend — módulo nuevo `src/modules/admin-users/`
1. `GET /admin/users?query&role&status&page` — paginado servidor, tenant-scoped (`users:read`).
2. `GET /admin/users/:id` — ficha completa: perfil, membresía vigente + historial, dispositivos (device tokens), `last_seen`, uso de storage (agregado F2), strikes de moderación (F4), tickets (F5), sesiones activas (familias de refresh no revocadas).
3. Acciones (todas auditadas):
   - `PATCH /admin/users/:id/status` `{status: ACTIVO|INACTIVO}` (`users:manage`) — generaliza el `staff/:userId/status` existente a cualquier rol del tenant; al pasar a INACTIVO revoca familias de refresh (`revokeFamily`).
   - `POST /admin/users/:id/password-reset` (`users:manage`) — reutiliza `password-reset.service` (emite token + correo); nunca devuelve el token.
   - `POST /admin/users/:id/sessions/revoke` (`users:manage`) — todas las familias.
   - `PATCH /admin/users/:id/role` (`users:danger`) — solo entre `CLIENTE|COACH|FRONT_DESK|ENTRENADOR_EXTERNO`; **jamás** ADMIN ni SYSTEM_ADMIN desde esta consola (elevar a ADMIN es de `/sistema`).
   - `POST /admin/users/:id/anonymize` (`users:danger`, doble confirmación) — borra PII y filas de contenido; los binarios MinIO permanecen (D2) y se documenta en la respuesta. Diseño exacto del borrado se decide con la pregunta abierta P4.
4. Los endpoints de creación siguen en membership (el alta con membresía es su dominio); esta consola enlaza.

### Frontend
5. `/admin/usuarios` (upgrade): filtros rol/estado/membresía + paginación; fila → `/admin/usuarios/[id]`.
6. Ficha `[id]` con tabs: **Perfil** (datos + acciones), **Membresía**, **Actividad** (last seen, dispositivos, sesiones), **Archivos** (Drive filtrado a su prefijo), **Moderación** (strikes/reportes), **Soporte** (tickets). Acciones destructivas con confirm de dos pasos.

### Verificación F3
- Unit: transiciones de estado + revocación en cascada; límites de cambio de rol; tenant-scope (usuario de otro tenant → 404).
- E2E: desactivar usuario → su refresh deja de funcionar (401) y no puede loguearse.

---

## 7. F4 — Motor de moderación — **IMPLEMENTADA (2026-09-15)**

> **Decisión P1 resuelta:** FRONT_DESK **sí** puede moderar, pero sólo por concesión explícita de
> `moderation:read` / `moderation:act`. El rol es el piso; el permiso lo estrecha.
>
> **Lo entregado se apoya en dos productos que llevan una década moderando a escala:**
>
> - **Escalera de sanciones (Facebook).** La duración NO la elige quien modera: la calcula el
>   historial. Aviso → 1 → 3 → 7 → 30 días → expulsión, y las faltas **caducan al año**. El
>   endpoint acepta `sanction: boolean`, nunca días: dejar elegir la duración reabriría la
>   arbitrariedad que la escalera existe para cerrar. La consola enseña la sanción que tocaría
>   **antes** de decidir.
> - **Un caso es el contenido, no cada queja (Facebook).** Cinco denuncias sobre una foto son UNA
>   tarjeta con cinco reportes; resolverla las cierra todas. Con bloqueo (`claim`) para que dos
>   moderadores no decidan por separado sobre lo mismo.
> - **Auto-ocultado por umbral (Tinder).** Tres denunciantes **distintos** retiran el contenido sin
>   esperar a un humano. Reversible, sin sancionar a nadie, y atribuido al sistema (moderador nulo).
> - **Denunciar es dejar de ver (Tinder).** Reportar crea el pase de descubrimiento y rompe la
>   conexión en el acto, sin esperar al veredicto.
> - **Ocultar no es borrar (ADR-0010).** `hidden_at` apaga la fila; el binario nunca se toca.
>   Verificado: tras sancionar, las 2 filas seguían con su `storage_key` intacta y el feed servía 0.
>
> **Cobertura del ocultamiento:** los 5 caminos de lectura de fotos (galería, feed de stories,
> espectadores, chat, visitas de perfil y baraja de descubrimiento) y el feed de stories filtran
> `hidden_at IS NULL`. La suspensión se comprueba en **cada petición** (`jwt.strategy`) y en el
> login, no sólo al entrar.
>
> **Evidencia ejecutada contra PostgreSQL 16 real:** migración aplicada y revertida sin residuos;
> umbral disparando exactamente al 3.er denunciante distinto y no antes; reporte repetido → 409;
> 3 reportes agrupados en 1 tarjeta; denuncia por menor ordenada por delante (urgencia 3);
> `claim` dos veces → 201 y luego 409; tipo de contenido inventado → 400; escalera subiendo sola
> (1.ª falta ADVERTENCIA → 2.ª SUSPENSION 1 día) y login bloqueado con fecha; auditoría registrando
> ambos veredictos.
>
> **Puertas:** backend 600 tests en 85 suites contra Postgres real, lint, type-check y build;
> frontend 195 tests, lint, type-check, build (`/admin/moderacion` presente) y `apps/mobile`
> type-check en verde.
>
> **No entregado de esta fase:** el reporte de mensajes de chat existe en el modelo pero la UI sólo
> lo ofrece sobre perfiles (`/perfil/[userId]`); stories y fotos se pueden reportar por API pero aún
> no tienen botón propio en su visor.

### Diseño original

### Modelo (migración `202609150002-moderation.ts`, schema `moderation`)
- `moderation.reports`: `id, tenant_id, reporter_user_id, target_kind ENUM(STORY, PROFILE_PHOTO, CHAT_MESSAGE, USER), target_id uuid, storage_key text NULL, reason ENUM(SPAM, DESNUDO, ACOSO, VIOLENCIA, SUPLANTACION, OTRO), details text NULL, status ENUM(PENDIENTE, EN_REVISION, RESUELTO, DESCARTADO) DEFAULT PENDIENTE, resolution ENUM(SIN_ACCION, CONTENIDO_OCULTO, USUARIO_ADVERTIDO, USUARIO_SUSPENDIDO) NULL, resolved_by uuid NULL, resolved_at, resolution_note, created_at` + índices `(status, created_at)`, `(target_kind, target_id)`, único parcial `(reporter_user_id, target_kind, target_id) WHERE status='PENDIENTE'` (no duplicar reporte pendiente).
- `moderation.user_strikes`: `id, user_id, tenant_id, report_id FK, kind ENUM(ADVERTENCIA, SUSPENSION), expires_at NULL, issued_by, note, created_at`.
- Columnas de ocultamiento en los blancos: `profile.stories` y `profile.photos` ganan `hidden_at timestamptz NULL, hidden_by uuid NULL` (los feeds/galerías filtran `hidden_at IS NULL`; el purge de stories existente no cambia). Mensajes de chat no se ocultan en v1 (se modera al usuario) — evita reescribir receipts.
- `usuarios.suspended_until timestamptz NULL` — el JWT strategy y el login rechazan con error explícito mientras `now() < suspended_until` (no se toca el enum `UserStatus`).

### Backend
1. **Lado usuario** (módulo `moderation/`): `POST /me/reports` con unión discriminada por `target_kind` (valida existencia + visibilidad del blanco para el reportante; resuelve `storage_key` si aplica; mismo tenant). Rate-limit específico.
2. **Lado admin** (`@Roles(ADMIN)` + permisos `moderation:*`, tenant-scoped; espejo global en `/sistema`):
   - `GET /admin/moderation/reports?status&kind&page` (cola, ordenada por antigüedad).
   - `GET /admin/moderation/reports/:id` — con preview resuelto del contenido (URL/stream vía F2) y contexto del reportado (strikes previos).
   - `POST /admin/moderation/reports/:id/claim` (pasa a EN_REVISION, se asigna).
   - `POST /admin/moderation/reports/:id/resolve` `{resolution, note, hideContent?, warn?, suspendDays?}` — transaccional: oculta fila (si aplica), crea strike, fija `suspended_until`, revoca sesiones si suspende, notifica (punto 3), audita.
   - `GET /admin/moderation/users/:id/history`.
3. **Notificaciones**: al resolver, push + notificación in-app al reportante ("tu reporte fue revisado") y al infractor (advertencia/suspensión con motivo), reutilizando `notifications/` y un mensaje del chat de sistema corporativo (`system-chat`) para que quede rastro conversacional.
4. Métricas de cola (pendientes, tiempo medio de resolución) expuestas al dashboard F6.

### Frontend
5. **Cliente** (web + móvil comparten `packages/`): acción "Reportar" en story, foto de perfil, mensaje y perfil (menú contextual) → sheet con motivo + detalle. Estado vacío honesto tras enviar.
6. **Admin `/admin/moderacion`**: cola con preview inline, filtros, detalle lateral con el contenido, historial del usuario y botonera de resolución (acciones destructivas en rojo, confirm). Badge de pendientes en la nav.

### Verificación F4
- Unit: transiciones de estado del reporte, unicidad de pendiente, efecto de `suspended_until` en jwt.strategy (401 con código propio), ocultamiento filtra feeds (specs de stories.repository).
- E2E: reportar story → resolver con ocultar + suspender 7 días → la story desaparece del feed del tenant, el usuario no puede loguearse, el objeto MinIO sigue existiendo (assert vía Drive).

---

## 8. F5 — Motor de soporte

### Modelo (migración `202609150003-support.ts`, schema `support`)
- `support.tickets`: `id, tenant_id NULL (NULL = corporativo), conversation_id FK chat.conversations, opened_by_user_id, assigned_to_user_id NULL, status ENUM(ABIERTO, ESPERANDO_USUARIO, RESUELTO, CERRADO) DEFAULT ABIERTO, priority ENUM(BAJA, NORMAL, ALTA) DEFAULT NORMAL, category ENUM(MEMBRESIA, ACCESO, APP, PAGOS, OTRO) NULL, subject text NULL, first_response_at NULL, resolved_at NULL, reopened_count int DEFAULT 0, created_at, updated_at` + índices `(tenant_id, status, updated_at DESC)`, `(assigned_to_user_id, status)`, único parcial `(conversation_id) WHERE status IN ('ABIERTO','ESPERANDO_USUARIO')`.
- `support.ticket_notes`: `id, ticket_id, author_user_id, body, created_at` (internas, jamás visibles al usuario).
- `support.canned_replies`: `id, tenant_id NULL, title, body, updated_by` (globales + por tenant).

### Backend (módulo `support/`)
1. **Hook de apertura**: al persistir un mensaje entrante en una conversación de sistema (kind corporativo o admin-del-tenant) sin ticket abierto, se crea ticket ABIERTO (en la transacción del propio send). Reabrir: mensaje sobre ticket RESUELTO → `reopened_count+1`, vuelve a ABIERTO.
2. Endpoints admin (`support:read`/`support:respond`, tenant-scoped; los corporativos solo en `/sistema`):
   - `GET /admin/support/tickets?status&assigned&priority&page` (con snippet del último mensaje y no-leídos).
   - `GET /admin/support/tickets/:id` — hilo completo (mensajes vía chat repo) + notas + datos del usuario (link ficha F3).
   - `PATCH /admin/support/tickets/:id` `{status?, priority?, category?, assignedToUserId?, subject?}` — `first_response_at`/`resolved_at` los fija el sistema, no el cliente.
   - `POST /admin/support/tickets/:id/notes`.
   - `GET/POST/PATCH /admin/support/canned-replies`.
   - **Responder** = el endpoint de envío de chat existente (el ADMIN ya es participante de la conversación admin-del-tenant). Para tickets corporativos, el `SYSTEM_ADMIN` responde **como la cuenta corporativa** vía `POST /admin/system/support/tickets/:id/reply` (el server actúa con el userId corporativo y audita quién fue el actor real).
3. Al responder desde soporte: si el ticket estaba ABIERTO fija `first_response_at` y pasa a ESPERANDO_USUARIO. Notificación push al usuario (infra existente).
4. Métricas para F6: tickets abiertos, tiempo a primera respuesta, tiempo a resolución, reaperturas.

### Frontend
5. `/admin/soporte`: inbox de dos paneles (lista con estado/prioridad/asignado + hilo a la derecha reutilizando los componentes de chat web), composer con canned replies, panel lateral de ticket (estado, asignación, notas internas, ficha del usuario). Realtime por el gateway existente. Badge de abiertos en la nav.
6. `/sistema/soporte`: mismo feature con scope corporativo/global.

### Verificación F5
- Unit: hook de apertura idempotente (un ticket abierto por conversación), transiciones, `first_response_at` solo una vez.
- E2E: usuario escribe al soporte → ticket aparece en inbox → responder → usuario recibe el mensaje en su chat y el push; resolver → nuevo mensaje del usuario lo reabre.

---

## 9. F6 — Consola de sistema: monitoreo

### Backend (módulo `system-console/`, todo `@Roles(SYSTEM_ADMIN)`)
1. `GET /admin/system/overview` — versión desplegada (commit/fecha), uptime, memoria, entorno, pool Sequelize (del registro de métricas), ready-check DB, ping MinIO (`bucketExists` con timeout corto), conteo de tenants/usuarios activos.
2. `GET /admin/system/metrics/summary?range` — lee `HttpMetricsService`: RPS, tasa de error 4xx/5xx, p50/p95 por ruta (top N), series descartadas por el guard de cardinalidad.
3. `GET /admin/system/outbox` — backlog, fallidos, edad del más viejo (tablas de `integration/`).
4. `GET /admin/system/notifications/delivery` — tasa de fallo de `delivery-attempt` por canal, últimos errores.
5. `GET /admin/system/storage` — totales del bucket (reusa el walk cacheado de F2 con scope global) por categoría/tenant.
6. `GET /admin/system/moderation` y `/support` — agregados de F4/F5 a nivel plataforma.
7. `GET /admin/tenants` ya existe → se añade `PATCH /admin/tenants/:id` (nombre/estado) y conteos por tenant.
8. `GET /admin/system/audit` (de F1).

### Frontend `/sistema/*`
9. Páginas: **Resumen** (overview + salud con semáforos), **Tráfico** (tablas p95/error rate — nada de charts hasta tener datos reales; luego sparklines), **Colas** (outbox + delivery), **Almacenamiento**, **Tenants** (C5: primera UI), **Auditoría**, **Soporte corporativo** (F5), **Moderación global** (F4), **Archivos** (F2 global), **Analítica** (F7).
10. Auto-refresh sobrio (30 s, pausado en background), estados vacíos honestos.

### Infra (VPS, vía Coolify — prerequisito: instalar la llave SSH pública pendiente)
11. Servicios: **Prometheus** (scrape de `/api/v1/health/metrics` con el token del `metrics-scrape.guard`, red interna), **Grafana** (dashboards provisionados como JSON en el repo: API HTTP, Postgres, MinIO, Node), **Loki + Promtail** (logs de contenedores), **Alertmanager** (reglas: 5xx > umbral, ready fallando, backlog outbox creciendo, disco). Alternativa mínima si se quiere posponer: **Uptime Kuma** solo con checks de `/live`/`/ready` — la capa in-app (puntos 1–10) no depende de esta decisión (D7).

### Verificación F6
- Unit: summaries del registro de métricas (fixtures), ping MinIO con timeout.
- Manual: `docker compose` local con Prometheus apuntando al backend dev; dashboards cargan; alerta de prueba dispara.

---

## 10. F7 — Consola de sistema: webtracking (analítica de producto)

### Modelo (migración `202609150004-analytics.ts`, schema `analytics`)
- `analytics.event_definitions`: `key text PK, label, description, platform ENUM(WEB, MOBILE, AMBAS), is_active bool` — taxonomía gobernada (editable con `analytics:admin`, la llave sembrada en Fase 0 por fin gatea algo).
- `analytics.events`: `id bigserial, occurred_at, received_at, tenant_id NULL, user_id uuid NULL, anon_id uuid NULL, session_id uuid, platform, event_key FK, route text NULL, props jsonb (validado y acotado ≤2KB)` — particionada por mes (`PARTITION BY RANGE (occurred_at)`); **sin IP ni user-agent crudos** (privacidad primero; P2 decide si se amplía).
- `analytics.daily_rollups`: `day date, tenant_id NULL, metric text, dimension text NULL, value numeric, PK(day, tenant_id, metric, dimension)` — DAU, sesiones, eventos por key, usuarios nuevos, retención D1/D7/D30.

### Backend
1. `POST /track` — batch (≤50 eventos), autenticado (sesión) o anónimo (anon_id emitido por el cliente), rate-limit generoso pero real, valida `event_key` contra taxonomía activa; inserción por lotes. **Nunca** bloquea al producto: errores se tragan con log.
2. Worker `workers/analytics-rollup.command.ts` (patrón `outbox-prune`): rollup del día anterior, idempotente; programado por el mismo mecanismo que los workers existentes.
3. Endpoints consola: `GET /admin/system/analytics/overview?range` (DAU/WAU/MAU, sesiones, eventos), `/by-tenant`, `/by-event`, `/retention`; y para el ADMIN de gimnasio una vista mínima tenant-scoped `GET /admin/analytics/overview` (`analytics:read`).
4. **GA4 opcional (dual-write)**: transformador outbox → Measurement Protocol, tal como lo diseñó el plan v1 §4. Activable por env; no bloquea F7 (P3).

### Frontend
5. `packages/analytics/` — cliente diminuto compartido: `track(eventKey, props?)`, buffer + flush (visibilitychange/intervalo), respeta `navigator.doNotTrack` y solo se activa con consentimiento si P2 lo exige. Web: hook de App Router para page_views (route template, no URL cruda). Mobile: hook Expo equivalente.
6. Instrumentación inicial (taxonomía v1, ~15 eventos): `page_view`, `login`, `signup`, `story_publish`, `story_view`, `chat_message_send`, `workout_start/finish`, `membership_renewal_intent`, `report_submit`, `support_message`, `tutorial_complete`, `discovery_like/pass`, `profile_photo_upload`.
7. `/sistema/analitica`: tarjetas DAU/WAU/MAU + retención + top eventos + desglose por tenant y plataforma (tablas primero; charts cuando haya series).

### Verificación F7
- Unit: validación de batch, taxonomía inactiva rechaza, rollup idempotente (correr dos veces = mismo resultado).
- Manual: navegar la web genera `page_view` visibles en `/sistema/analitica` tras rollup manual.

---

## 11. F8 — Endurecimiento, E2E y GA

1. **E2E Playwright** de los cinco encargos (matriz mínima: ADMIN, FRONT_DESK con/sin permiso, SYSTEM_ADMIN, CLIENTE-403): Drive navega y descarga; reporte → resolución completa; ticket ida y vuelta; gestión de usuario (desactivar/reactivar); consola sistema carga con datos.
2. **Seguridad**: revisión de las superficies nuevas (IDOR de tenant-scope en files/users/moderation/support es el riesgo nº 1; streams de `content` sin cache-control público; rate-limits de `/track` y `/me/reports`).
3. **Seeds de demo** (`admin-portal-demo.seed.ts`, solo entornos no productivos): reportes, tickets y eventos sintéticos para que las consolas no nazcan vacías en QA.
4. Docs: ADR nuevo (extensión del puerto de storage con lectura), README por módulo nuevo (patrón del repo), actualización de la bóveda `GymSheetDocs` existente (no crear otra).
5. Checklist de despliegue por fase: migración → deploy backend → deploy web → smoke en VPS (`git push origin dev` → Actions → Coolify; nunca a mano).

---

## 12. Orden de entrega y dependencias

| Fase | Entregable | Depende de | Estimación |
|---|---|---|---|
| F1 | Cimientos: SYSTEM_ADMIN end-to-end, audit log, permisos nuevos, correcciones C1–C5 | Fase 0 (hecha) | 3–4 d |
| F2 | Drive MinIO (`/admin/archivos` + `/sistema/archivos`) | F1; VPS MinIO solo para prod | 4–5 d |
| F3 | Gestión de usuarios | F1 (F2 para tab Archivos) | 4–5 d |
| F4 | Moderación | F1, F3 (suspensión), F2 (previews) | 5–6 d |
| F5 | Soporte | F1; F3 (ficha) | 5–6 d |
| F6 | Consola sistema: monitoreo (in-app + infra) | F1; F4/F5 solo para sus tarjetas | 4–5 d + 1–2 d infra |
| F7 | Webtracking + dashboards | F1; F6 (consola donde vive) | 4–5 d |
| F8 | E2E, seguridad, seeds, docs, GA | todas | 3–4 d |

Cada fase es desplegable sola. Camino crítico: F1 → (F2 ∥ F3) → F4 → F5 → F6 → F7 → F8. Total ~6–7 semanas a un dev.

## 13. Plan de pruebas (transversal)

- Backend: unit + integration specs por módulo nuevo (patrón actual; suite hoy en verde con 349 tests); migraciones up/down contra Postgres dockerizado.
- Frontend: type-check + build en cada fase (los task de lint/vitest de `@gymsheet/web` tienen los problemas locales conocidos — memoria `gymsheet-web-local-run` — no son bloqueo de CI).
- Los guards se prueban en las dos direcciones: el rol sin permiso NO ve; el permiso sin rol NO ve; tenant ajeno = 404.

## 14. Riesgos y preguntas abiertas

| # | Pregunta | Bloquea |
|---|---|---|
| P1 | ¿FRONT_DESK puede recibir permisos de moderación/soporte, o son solo de ADMIN? (el catálogo lo permite; es decisión de producto) | F4/F5 (default propuesto: sí, vía grant explícito) |
| P2 | Privacidad/consentimiento del tracking first-party (banner, aviso en `/privacidad`): ¿requisito legal en el mercado objetivo? | Activar F7 en prod (no su desarrollo) |
| P3 | ¿GA4 además del first-party? (Measurement ID + API secret) | Solo el dual-write opcional |
| P4 | Semántica exacta de `anonymize` (qué tablas se limpian vs. anonimizan) | La acción `users:danger` de F3 |
| P5 | ¿Grafana/Prometheus completo o Uptime Kuma primero? | Solo la capa infra de F6 |
| P6 | Cuenta corporativa de soporte (`SEED_SYSTEM_CORPORATE_EMAIL`): ¿quién la posee en prod? | F5 corporativo |
| P7 | Llave SSH del VPS sin instalar → sin acceso para la capa infra | F6 infra y MinIO prod |

## 15. Archivos críticos de referencia

- Backend: `src/modules/admin-access/*` (patrón guard + catálogo), `src/modules/media/media-storage.port.ts` + `adapters/*`, `media-references.repository.ts`, `src/modules/chat/system-chat.service.ts`, `src/common/metrics/http-metrics.service.ts`, `src/modules/health/README.md`, `src/workers/outbox-prune.command.ts`, `src/database/migrations/index.ts`.
- Frontend: `packages/types/src/enums.ts`, `packages/domain/src/permissions.ts`, `apps/web/src/shared/server/session.ts`, `apps/web/src/shared/components/layout/nav-config.ts`, `apps/web/src/features/admin/*`, `apps/web/src/app/(portal)/admin/*`.
- Docs: `docs/decisions/ADR-0010-minio-immutable-media.md`, `docs/plan/PLAN-MINIO-MEDIA.md`, `GymSheetFrontend/docs/plan/PLAN-PARIDAD-WEB.md` (H1 Web Push).
