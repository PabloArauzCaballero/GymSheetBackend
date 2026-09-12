# Despliegue en Coolify

Calco del patrón de los repos de Atlas: mismo VPS, mismo panel.

**Estado: el primer despliegue automático ya salió verde.** El 12/09/2026 a las 03:08 UTC Coolify
terminó el despliegue del commit `343c6c8` lanzado por `git push origin dev`
([run 34667590466](https://github.com/PabloArauzCaballero/GymSheetBackend/actions/runs/34667590466)).
La cadena completa —Tailscale, webhook, construcción, migraciones, API— funciona sin intervención.
El apartado de abajo con los pasos manuales queda como referencia de lo que hubo que configurar una
vez; no hay que repetirlo.

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

## Workers: definidos, apagados por defecto

Los cinco workers (`access-event`, `membership-reminder`, `notification-delivery`, `stories-purge`,
`exercises-dataset-refresh`) ya están en `docker-compose.coolify.yml`, pero **no arrancan salvo que
se pidan**. Para encenderlos, añadir en las variables de la aplicación en Coolify:

```
COMPOSE_PROFILES=workers
```

y redesplegar. Comprobado que Docker Compose lee esa variable del archivo de entorno que Coolify
pasa con `--env-file`: sin ella el despliegue levanta exactamente los cuatro servicios de siempre
(`postgres`, `redis`, `migrate`, `api`); con ella, esos cuatro más los cinco workers.

Están apagados por defecto a propósito: cada worker es un proceso Node completo con el runtime de
Nest dentro (límite de 320 MB cada uno) y encenderlos los cinco a ciegas puede dejar sin memoria al
VPS y tumbar la API, que es lo que de verdad no puede caerse. Con el consumo real del servidor
delante, se encienden.

Consecuencia de tenerlos apagados, para decidir con conocimiento: los avisos de vencimiento de
membresía no salen solos, las notificaciones del outbox transaccional no se entregan, las stories
caducadas no se borran y los eventos de acceso físico se acumulan sin drenar. Nada de eso pierde
datos —el trabajo queda en cola en base de datos y se procesa en cuanto los workers arrancan—, pero
tampoco ocurre mientras estén apagados.

## Media: ya persiste entre despliegues

`MEDIA_STORAGE_PROVIDER=local` escribe en `/app/storage/media`, que ahora es un volumen nombrado
(`media-data`) montado en el servicio `api`. Antes cada despliegue estrenaba contenedor y las
imágenes subidas desaparecían **sin error visible**: la fila en base de datos sobrevivía y la URL
devolvía 404. El `Dockerfile` ya creaba ese directorio como usuario `node` precisamente para que un
volumen montado ahí heredase la propiedad correcta al crearse.

## Lo que sigue pendiente y no depende del código

- **Dominio público de la API**, si debe ser alcanzable desde fuera de la red `coolify`. Lo necesita
  el socket de chat del frontend (ver `docs/despliegue.md` de GymSheetFrontend). Se configura en
  Coolify → Domains de la aplicación.
