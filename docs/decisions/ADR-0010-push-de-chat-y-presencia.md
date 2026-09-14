# ADR-0010 — El chat avisa al teléfono: productor de push y presencia

Estado: aceptado · Fecha: 2026-09-13

## Contexto

`01441a0` dejó el circuito de push montado: tabla de dispositivos, alta y baja
autenticadas, y `ExpoPushService` colgado de `InAppNotificationAdapter` como
efecto lateral best-effort. El push es aditivo: no es un canal nuevo, viaja con
la notificación in-app que ya existía.

El problema es quién lo dispara. Las únicas notificaciones in-app que el sistema
produce hoy son los recordatorios de vencimiento de membresía. **El chat no
produce ninguna**: `ChatService` emite por socket y nada más. Es decir, el caso
que justifica el push en una app con chat —alguien te escribe y no tienes la app
abierta— no llegaba a ninguna parte.

## Decisión

`ChatService.persistMessage` —el único punto que escribe un mensaje, por el que
pasan tanto el REST como el gateway de sockets— empuja al teléfono de cada
participante **que no tenga un socket abierto**, usando el `ExpoPushService` que
ya existe. `NotificationsModule` lo exporta; `ChatModule` lo importa.

Va directo al servicio, sin pasar por `notifications.messages`. Encolar un
mensaje in-app por cada mensaje de chat duplicaría en la bandeja lo que el chat
ya muestra en su sitio, y convertiría una conversación de veinte mensajes en
veinte avisos que leer.

## Consecuencias

- **Quien está conectado no recibe push.** El socket ya le entregó el mensaje;
  el push encima sería un doble aviso. `ChatPresenceService` ya llevaba esa
  cuenta para pintar "en línea", no hubo que inventar nada.
- **La presencia es del proceso.** Con varias instancias de la API, alguien
  conectado a otra instancia recibiría push igual. Es asumible con el despliegue
  de una sola instancia que hay hoy; con más, la presencia tendría que ser
  compartida (Redis), y eso es otro cambio con su propio ADR.
- **Un fallo del aviso no rompe el envío.** `sendToUser` ya es best-effort por
  diseño; el `try/catch` de aquí cubre además las consultas de participantes y
  del remitente. El mensaje ya está escrito y emitido cuando esto corre.
- **La vista previa no adelanta el contenido de un medio.** Una foto de vista
  única anuncia que llegó una foto de vista única, no la enseña en la pantalla
  bloqueada. El texto se recorta a 140 caracteres.
- **Sin reintentos.** Si Expo está caído en ese instante, ese aviso se pierde y
  solo queda en el registro. Es coherente con el diseño de `01441a0`, donde el
  push es aditivo y la fuente de verdad es el mensaje ya entregado por socket y
  guardado en `chat.messages`.

## Alternativa descartada: `PUSH` como canal propio

Se llegó a implementar —con bandeja de salida, reintentos, `delivery_attempts`,
interruptor por entorno y distinción entre fallos reintentables y terminales— en
paralelo y sin saber de `01441a0` (queda en la rama local `push-canal-propio`).
Se descarta: colisionaba con la tabla `notifications.device_tokens` ya publicada
y obligaba a migrar el esquema de Pablo por una diferencia que, para el aviso de
un mensaje de chat, no paga lo que cuesta. Un mensaje que no sonó porque Expo
estaba caído treinta segundos se sustituye solo: el siguiente mensaje de esa
conversación vuelve a avisar, y al abrir la app el historial está entero.

Si algún día se encolan por push cosas que **no** se pueden perder —un aviso de
cobro, un cambio de plan—, ese trabajo vuelve a tener sentido y está escrito.
