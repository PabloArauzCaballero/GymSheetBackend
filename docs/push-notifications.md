# Notificaciones push (Expo)

Cómo llega un aviso al teléfono, qué lo dispara y cómo se comprobó.

## El camino completo

1. La app móvil pide permiso, obtiene el token de Expo y lo manda a
   `POST /notifications/device-tokens` en cuanto hay sesión. Al cerrar sesión lo
   da de baja con `DELETE`, antes de borrar el bearer.
2. El backend guarda una fila por dispositivo en `notifications.device_tokens`.
   El token es único en toda la tabla: un mismo teléfono que cambia de cuenta
   **reasigna** el dueño en vez de duplicarse.
3. Algo dispara el aviso. Hay dos productores:
   - **Notificaciones in-app** (hoy: recordatorios de vencimiento de membresía).
     `InAppNotificationAdapter` empuja al teléfono como efecto lateral, sin
     cambiar el canal del mensaje, que sigue siendo `IN_APP`.
   - **Mensajes de chat**: `ChatService.persistMessage` empuja a cada
     participante que no tenga un socket abierto. No pasa por
     `notifications.messages` — el chat ya muestra el mensaje en su sitio.
4. `ExpoPushService` manda todos los tokens activos de esa persona al servicio
   de Expo, en lotes de como mucho 100, y desactiva los que Expo declare
   `DeviceNotRegistered`.

Expo es quien habla con FCM (Android) y APNs (iOS), con las credenciales que ya
viven en el proyecto de EAS. El backend solo conoce tokens
`ExponentPushToken[...]`: aquí no hay ninguna clave de Google ni de Apple.

## Reglas que conviene conocer antes de tocar esto

- **Quien está conectado por socket no recibe push del chat** — ya le llegó el
  mensaje. La presencia es del proceso: con más de una instancia de la API
  volverían los avisos duplicados y habría que compartirla (Redis).
- **La baja exige ser el dueño** (`WHERE user_id AND expo_push_token`). Sin esa
  condición, cualquiera con sesión podría silenciar un teléfono ajeno mandando
  un token que no es suyo.
- **El alta reactiva un token desactivado.** Que la app vuelva a registrarlo
  significa que el dispositivo está vivo otra vez.
- **`DeviceNotRegistered` desactiva el token** en el acto. No hace falta
  limpieza manual.
- **El push nunca lanza.** Un fallo de Expo no puede tumbar la entrega in-app ni
  convertir un mensaje de chat correcto en un 500. Queda en el registro
  (`push.ticket_error`, `push.request_failed`, `chat.push_notify_failed`).
- **No hay reintentos.** Si Expo está caído en ese momento, ese aviso concreto se
  pierde. Ver `docs/decisions/ADR-0010-push-de-chat-y-presencia.md` para por qué
  se aceptó, y qué habría que hacer si algún día se empuja algo que no se puede
  perder.
- **La vista previa no adelanta medios.** Una foto de vista única se anuncia
  como tal; el texto se recorta a 140 caracteres.

## Verificación ejecutada (2026-09-13)

Contra la API real (`yarn start`, puerto 3011), PostgreSQL 16 en Docker recién
migrado y sembrado, y **el servicio real de Expo** (`exp.host`), con las cuentas
`athlete.mock` y `coach.mock`.

| Caso | Resultado observado |
|---|---|
| Alta del dispositivo | `{"registered":true}`, una fila con `active = true` |
| Mensaje de chat con el destinatario **sin** socket | El aviso salió: Expo respondió `DeviceNotRegistered` al token ficticio y la fila quedó `active = false` |
| El mismo token dado de alta otra vez | Vuelve a `active = true` |
| Mensaje con el destinatario **conectado** al socket `/chat` | **Ninguna** llamada a Expo (el registro no sumó ni una línea) y el token siguió activo |
| Mismo mensaje tras cerrar el socket | Vuelve a salir el aviso |

El registro de la primera fila, literal:

```
WARN [ExpoPushService] {
  event: 'push.ticket_error',
  message: '"ExponentPushToken[verificacion-chat]" is not a valid Expo push token',
  errorCode: 'DeviceNotRegistered'
}
```

Es un token inventado a propósito: demuestra que la petición llegó al servicio
real y que el ticket de error se interpreta y se aplica.

**Comandos**

```
yarn lint       → sin hallazgos
yarn type-check → sin errores
yarn test       → 75 suites, 514 pruebas en verde (con PostgreSQL vivo)
yarn build      → nest build correcto
yarn migration:up sobre base vacía → aplica 202609131200-device-tokens limpio
```

**Lo que no se probó:** la llegada a un teléfono físico con el binario de EAS
instalado, y el envío a un token válido de verdad. Para eso hace falta un
dispositivo real; iOS además necesita el perfil de aprovisionamiento con la
capacidad de push habilitada en EAS.
