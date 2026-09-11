# Despliegue en Coolify

Calco del patrón de los repos de Atlas: mismo VPS, mismo panel. Este documento es la lista de lo
que falta para que `git push origin dev` despliegue solo, no una confirmación de que ya está hecho.

Archivos ya en el repo:

- `docker-compose.coolify.yml` — cómo construye y levanta Coolify esta API (servicio `migrate` +
  servicio `api`, sin `ports:`, sin `env_file:`, en la red `coolify`).
- `.github/workflows/deploy-dev.yml` — dispara el webhook de Coolify en cada push a `dev` y espera
  el veredicto real del despliegue, no solo la confirmación de que la orden llegó.

## Lo que falta hacer a mano en Coolify (una vez)

1. Crear la aplicación en el proyecto de Coolify (mismo servidor que Atlas,
   `http://100.101.207.88:8000`), tipo *Docker Compose*, apuntando a este repo, rama `dev`,
   archivo `docker-compose.coolify.yml`.
2. Generar una deploy key SSH (par nuevo — GitHub no admite la misma llave en dos repos),
   registrar la privada en Coolify y añadir la pública como *deploy key* de solo lectura en
   `GymSheetBackend`.
3. Postgres y Redis van DENTRO de `docker-compose.coolify.yml` (servicios `postgres` y `redis`
   de este mismo stack, con volumen propio para Postgres) — no hace falta crear esos recursos
   aparte en Coolify. `DB_HOST`/`DB_PORT`/`REDIS_URL`/`REDIS_REQUIRED` ya están fijados en el
   compose.
4. Pegar en la interfaz de la aplicación (no en el repo) el contenido de
   `.env.coolify.recommended` (generado junto a este documento, con los tokens/contraseñas ya
   creados). Marcar **todas** las variables como **"Runtime only"** (desmarcar "Available at
   Buildtime"): este backend no necesita nada en build-time, y dejarlas en build-time mete
   `NODE_ENV=production` en el build de Docker, lo que hace que `yarn build` truene con
   `exit 127` al saltarse las devDependencies.
5. Completar en ese archivo los dos valores que sí dependen de ti: `CORS_ORIGINS` (origen exacto
   del frontend) y `PORTAL_PUBLIC_URL` (dominio del frontend en Coolify, pestaña Domains).
6. Activar **Connect To Predefined Network** en la aplicación (red `coolify`).
7. Copiar el **Deploy Webhook** de la aplicación (`Webhooks` → lleva el UUID) y guardarlo como
   secret de GitHub.

## Secrets de GitHub Actions (Settings → Secrets and variables → Actions)

| Secret                            | Valor                                                            |
| ---------------------------------- | ----------------------------------------------------------------- |
| `PABLO_H310_TAILSCALE_AUTHKEY`       | Authkey efímera de Tailscale (consola de Tailscale)                |
| `PABLO_H310_COOLIFY_TOKEN`           | API token de Coolify con permisos `deploy` + `read`                |
| `PABLO_H310_COOLIFY_WEBHOOK` | Deploy webhook de esta aplicación en Coolify (lleva el UUID)        |

Si ya existe un token de Coolify de otro proyecto (Atlas) con permiso sobre todos los recursos del
servidor, puede reutilizarse el mismo valor para `PABLO_H310_COOLIFY_TOKEN` en vez de crear uno
nuevo.

## Lo que sigue pendiente tras el primer despliegue

- **Workers** (`access-event`, `membership-reminder`, `notification-delivery`,
  `exercises-dataset-refresh`): no están en `docker-compose.coolify.yml` todavía. El primer
  despliegue cubre solo la API; los workers se añaden como servicios adicionales del mismo compose
  cuando se necesiten en producción.
- **Dominio público**, si la API debe ser alcanzable desde fuera de la red `coolify` (por ejemplo,
  el frontend en producción llama al backend por un origen público para el socket de chat — ver
  `docs/despliegue.md` de GymSheetFrontend).
- **Proveedor de media** (`MEDIA_STORAGE_PROVIDER=local`): el volumen del contenedor no persiste
  entre despliegues salvo que se monte un volumen de Coolify; revisar antes de subir imágenes
  reales a producción.
