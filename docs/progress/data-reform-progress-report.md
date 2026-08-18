# Progress report — ejecución skill `github-canonical-data-reform`

**Fecha:** 2026-08-07 · **Actualizado:** 2026-08-12 · **Rama:** `fix/membership-seed-and-lock` ·
**Commit base:** `27f3fd2`

## 0. Decisiones del propietario (2026-08-12) e implementación

- **Media:** "infraestructura poligonal para cualquier proveedor + adaptador Multer" →
  **implementado** (puertos y adaptadores + adaptador local Multer, idempotente por sha256).
- **Selector:** opción b (worker + seed local) → **implementado** (config + validación fail-fast +
  hook de arranque).
- **Reforma de esquema:** "no hay" → ADR-0008 **cerrado como No aplica**.

### Código nuevo (todo verificado por gates)
- `src/modules/media/` — puerto `media-storage.port.ts`, `adapters/local-storage.adapter.ts`,
  `media-storage.factory.ts`, `media.schemas.ts`, `media.mapper.ts`, `media.repository.ts`,
  `media.service.ts`, `media.controller.ts` (`POST /api/v1/admin/media`, ADMIN), `media.module.ts`.
- `src/database/canonical-exercises-bootstrap.ts` — selector `CANONICAL_EXERCISES_SOURCE`.
- Env: `MEDIA_STORAGE_*`, `MEDIA_UPLOAD_MAX_BYTES`, `MEDIA_ALLOWED_MIME`, `CLOUDINARY_*` (opcional),
  `CANONICAL_EXERCISES_SOURCE` + refinamientos fail-fast. `.env.example` actualizado.
- Wiring: `app.module.ts` (MediaModule), `main.ts` (servido estático local), `database-bootstrap.ts`.
- Tests: 5 specs nuevos (4 media + 1 selector).
- **Sin dependencias nuevas** (Multer es transitivo de `@nestjs/platform-express`) y **sin migración**.

## 1. Avance realizado

- Fase 0–1 (auditoría) y fase 18 (reporte) completas.
- Reconciliación de los prerrequisitos de la skill contra el repo, con evidencia (rutas+líneas).
- Documentación: `docs/data-reform/*` (incl. `media-upload-endpoint.md`) y este reporte.
- ADR: **0006 aceptado (opción b)**, **0007 aceptado (implementado)**, **0008 cerrado (N/A)**.

## 2. Riesgos detectados

- El working tree tiene trabajo de **outbox/messaging sin commitear** (14 archivos M + 10 `??`). No
  se tocó para no mezclar diffs; cualquier cambio de código de la reforma debe ir en su propia rama.
- Ejecutar el import GitHub **dentro del arranque** (opción a de ADR-0006) acoplaría el readiness a la
  red externa. Por eso el default propuesto es `seeders`.

## 3. Decisiones clave

- Aplicar el precedente de alcance del audit doc §0: implementar lo que mapea al dominio real y
  declarar *No aplicable / bloqueado* lo que describe un sistema que este repo no es, **sin fabricar**.
- **No** añadir Cloudinary ni ninguna dependencia sin ADR (regla 70) ni sin credenciales.
- **No** diseñar migraciones de reforma sin especificación (regla 00 + skill §10.4).

## 4. Desviaciones respecto al flujo literal de la skill

- No hay repositorio de datos GitHub aparte (la fuente canónica real son los datasets de ejercicios).
- No hay reforma de esquema entregada → fases 4–6, 14, 17 bloqueadas.
- No hay Cloudinary ni credenciales → fase 8 bloqueada.

## 5. Fase actual

Auditoría + paquete de decisiones **completado**. A la espera de tres inputs del propietario para
desbloquear el trabajo de implementación (ver §8).

## 6. Pruebas ejecutadas (evidencia, 2026-08-12)

| Comando | Resultado |
|---|---|
| `yarn type-check` (`tsc --noEmit`) | **Exit 0** — "Done in 27.40s" |
| `yarn lint` (`eslint .`) | **Exit 0** — "Done in 188.94s" |
| `yarn test` (`jest --runInBand`) | **Exit 0** — 39 suites / **159 tests passed**, 0 fallos |
| `npx jest src/modules/media` | **4 suites / 14 tests passed** (adaptador, factory, schemas, service) |

### 6.2 Mirroring de media externa + relanzamiento Docker (2026-08-13)

Motivo: portadas de planes servidas desde Unsplash con `auto=format` → negociaban a **AVIF**
(no renderiza en varios clientes). Solución: comando `db:media:mirror` que copia la media externa a
nuestro almacenamiento forzando JPEG. Imagen reconstruida y stack relanzado.

| Comprobación | Resultado |
|---|---|
| `yarn type-check` · `yarn lint` | **0** · **0** |
| `yarn test` | **40 suites / 164 tests passed** |
| `docker compose build api` (tras fallo transitorio de red en `yarn install`, reintento) | **OK** |
| `db:media:mirror` (dry-run) | `candidates=3` |
| `db:media:mirror --apply` | `mirrored=3, failed=0` |
| `media.files` covers | `storage_url = http://localhost:3001/media/<sha256>.jpg` (procedencia Unsplash preservada) |
| Servido de cada portada | **200 `image/jpeg`** (163/169/221 KB — JPEG plano, sin AVIF) |
| Segunda corrida del mirror | `candidates=0` (idempotente) |

### 6.1 Verificación end-to-end en Docker (2026-08-12)

`docker compose up -d --build` (exit 0). Evidencia ejecutada:

| Comprobación | Resultado |
|---|---|
| `migrate` (one-shot) | **Exited (0)** |
| API `GET /health/live` · `/health/ready` | **200** · **200** (imagen nueva) |
| Root filesystem de la API | **solo lectura** (`touch /app/root-probe` → "Read-only file system") |
| Volumen `media-data` en `/app/storage/media` | **escribible** por `uid=1000(node)` |
| `POST /admin/media` (admin sembrado, JWT real) | **200**, archivo escrito `<sha256>.png` |
| Segunda carga (mismos bytes y `code`) | **200, `reutilizado: true`**, mismo `id`/`publicId` (idempotente en adaptador y en `media.files`) |
| `GET /media/<sha256>.png` (servido estático) | **200**, 24 bytes |

Esto cierra la verificación de idempotencia con doble corrida contra base real (skill §19.2).

## 7. Pruebas no ejecutadas y motivo

- `yarn test:e2e` (suite Jest e2e en :5433): no ejecutada; la verificación equivalente se realizó
  contra la pila Docker real (§6.1), que ejercita migraciones, arranque, seeds y el flujo de media
  extremo a extremo.

## 8. Próximos pasos

1. **Validación con DB real** (Docker): arranque completo, `POST /admin/media` end-to-end, doble
   corrida para confirmar idempotencia de `media.files`, y readiness.
2. **CloudinaryAdapter/S3Adapter**: cuando el propietario entregue credenciales (`CLOUDINARY_*` en
   `.env`), implementar el adaptador que cumpla `MediaStorageProvider` y registrarlo en el factory.
   No cambia nada más (endpoint, persistencia y contrato de frontend ya están).
3. **Snapshot de ejercicios** (opción b): versionar un snapshot real y cablear su carga en el
   arranque en modo `seeders`; hoy el worker sigue poblando el catálogo.
4. **OpenAPI**: integrar `POST /admin/media` a `docs/endpoints/openapi.yaml` cuando la rama de outbox
   se consolide (evitado ahora para no interferir con sus cambios sin commitear).

## 9. Estado general

**Verde.** Media (puertos y adaptadores + Multer) y selector `github|seeders` (opción b)
**implementados y verificados** por type-check + lint + 159 tests. Reforma de esquema: N/A por
decisión. Cloudinary/S3: adaptadores triviales pendientes solo de credenciales. Ninguna afirmación de
éxito sin evidencia ejecutada; la validación contra base real queda pendiente de entorno con DB.
