# Notificaciones push (Expo)

Cómo llega un aviso al teléfono, qué hay que configurar y cómo se comprobó.

## El camino completo

1. La app móvil pide permiso, obtiene el token de Expo y lo manda a
   `POST /notifications/device-tokens` en cuanto hay sesión
   (`apps/mobile/src/notifications/push.ts`). Al cerrar sesión lo da de baja con
   `DELETE`, antes de borrar el bearer.
2. El backend guarda una fila por dispositivo en `notifications.device_tokens`.
3. Algo del dominio encola un aviso por el canal `PUSH`
   (`NotificationService.enqueueDirectMessage`). Hoy el único productor es el
   chat: un mensaje a alguien sin socket abierto.
4. El trabajo de la bandeja de salida lo recoge el worker de entrega
   (`yarn worker:notifications`), que pide el adaptador del canal y envía.
5. `ExpoPushNotificationAdapter` manda todos los dispositivos activos de esa
   persona al servicio de Expo, en lotes de como mucho 100, y anota el
   resultado en `notifications.delivery_attempts`.

## Configuración

| Variable | Para qué |
|---|---|
| `PUSH_NOTIFICATIONS_ENABLED` | Interruptor. `false` por defecto: sin credenciales de push en EAS no tiene sentido intentar enviar. |
| `EXPO_PUSH_API_URL` | Endpoint de Expo. Por defecto `https://exp.host/--/api/v2/push/send`. En producción se exige HTTPS. |
| `EXPO_PUSH_ACCESS_TOKEN` | Solo si el proyecto de Expo activó la seguridad de envío. Es un secreto. |
| `EXPO_PUSH_TIMEOUT_MS` | Tiempo de espera por petición. |

No hay ninguna clave de Google ni de Apple aquí: las credenciales de FCM y APNs
viven en el proyecto de EAS, que es quien construye el binario, y Expo las usa
por nosotros.

## Reglas que conviene conocer antes de tocar esto

- **El token es único en toda la tabla**, no por usuario. Registrarlo con otra
  cuenta lo traslada: un teléfono no puede recibir los avisos de dos personas.
- **La baja exige ser el dueño.** Sin esa condición, cualquiera con sesión
  podría silenciar un teléfono ajeno mandando un token que no es suyo. La
  respuesta es la misma tenga o no algo que retirar, para no confirmarle a un
  tercero qué tokens existen.
- **Quien está conectado por socket no recibe push** — ya le llegó el mensaje.
  La presencia es del proceso: con más de una instancia de la API habría que
  compartirla (Redis) o volverían los avisos duplicados.
- **`DeviceNotRegistered` revoca el token** en el acto. No hace falta limpieza
  manual.
- **Sin dispositivos activos la entrega termina en `NO_ACTIVE_DEVICE`**, no en
  fallo: reintentar no hace aparecer un teléfono.
- **El canal `PUSH` no sale en `GET /notifications/me`.** Es una entrega a un
  dispositivo, no un elemento de la bandeja. Quien quiera las dos cosas encola
  dos mensajes.

## Cómo probarlo en local sin tocar Expo

Un servidor cualquiera que responda tickets sirve como servicio de Expo; en
desarrollo se acepta `http`:

```bash
PUSH_NOTIFICATIONS_ENABLED=true EXPO_PUSH_API_URL=http://localhost:4567/push yarn start
PUSH_NOTIFICATIONS_ENABLED=true EXPO_PUSH_API_URL=http://localhost:4567/push yarn worker:notifications
```

El cuerpo que recibe es un array de `{ to, title, body, data }` y basta con
devolver `{"data":[{"status":"ok","id":"..."}]}`. Para ver la revocación
automática, responder para ese token
`{"status":"error","details":{"error":"DeviceNotRegistered"}}`.

## Lo que falta

- **iOS necesita un perfil de aprovisionamiento con la capacidad de push**
  habilitada en EAS; Android ya tiene Firebase configurado.
- **Ningún otro productor.** Solicitudes de conexión, matches y recordatorios de
  membresía siguen sin avisar al teléfono. Encolar por el canal `PUSH` es una
  línea; decidir qué merece hacer sonar un teléfono no lo es.
- **No se ha enviado a un teléfono real.** Todo lo verificado abajo va contra el
  servicio de Expo simulado en local.

## Verificación ejecutada (2026-09-13)

Contra la API real (`yarn start`, puerto 3011), PostgreSQL 16 en Docker y un
servicio de Expo simulado en `localhost:4567`. Usuarios `athlete.mock` y
`coach.mock` de la siembra de desarrollo.

**Registro del dispositivo**

| Caso | Resultado |
|---|---|
| Alta con sesión válida | `{"registered":true}`, una fila en `device_tokens` |
| Alta repetida del mismo token | `{"registered":true}`, sigue habiendo **una** fila (refrescada) |
| Token que no tiene formato de Expo | HTTP 400, «El token de push no tiene el formato de Expo.» |
| `platform: "WEB"` | HTTP 400, «Expected 'ANDROID' \| 'IOS'» |
| Sin sesión | HTTP 401 |
| El mismo token registrado por la otra cuenta | Una sola fila, ahora a nombre de la segunda |
| Baja pedida por quien **no** es el dueño | La fila sigue activa |
| Baja pedida por el dueño | `revoked_at` puesto |

**Aviso de chat**

Con el coach **sin** socket: el mensaje del athlete encola una fila
`channel=PUSH, status=PENDING, subject='Athlete Mock'` y un trabajo
`notifications.delivery`. Con el coach **conectado** al socket (`/chat`): el
contador de avisos PUSH no se movió; al cerrar el socket y repetir, sí.

**Entrega**

El worker recogió el trabajo y el servicio simulado recibió dos mensajes, uno
por dispositivo activo, con `title`, `body` y `data.notificationId`. Resultado:

```
channel | status | enviado | provider  | response_code | provider_message_id
PUSH    | SENT   | t       | EXPO_PUSH | ACCEPTED_1    | ticket-1

expo_push_token                | platform | activo
ExponentPushToken[coach-DEAD]  | ANDROID  | f     <- revocado por DeviceNotRegistered
ExponentPushToken[coach-vivo]  | IOS      | t

queue_name             | status    | attempt_count
notifications.delivery | COMPLETED | 1
```

`GET /notifications/me` del coach devolvió `total: 0`: el aviso de chat no
ensucia la bandeja in-app.

**Un defecto que solo apareció al ejecutar.** La primera pasada no encoló nada
y dejó `chat.push_notify_failed / SequelizeDatabaseError` en el registro: la
restricción `ck_notification_channel` de `notifications.messages` es una lista
cerrada y no incluía `PUSH`, así que la escritura del aviso reventaba. Las
pruebas unitarias no podían verlo —usan dobles del repositorio, no la base—. La
migración ahora reemplaza la restricción.

**Comandos y resultados**

```
yarn lint                → sin hallazgos
yarn type-check          → sin errores
yarn test                → 75 suites, 515 pruebas, todas en verde (con PostgreSQL vivo)
yarn build               → nest build correcto
yarn migration:up/down/up → la tabla se crea, se revierte y se vuelve a crear
```

Del lado del móvil: `@gymsheet/mobile type-check` limpio y
`turbo run source-check type-check lint test` (22 tareas, 195 pruebas de web) en
verde.

**Lo que no se probó:** un envío real contra `exp.host` y la llegada a un
teléfono físico. Hace falta un dispositivo con el binario de EAS instalado.
