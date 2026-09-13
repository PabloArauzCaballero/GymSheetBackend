# ADR-0010 — Canal PUSH: registro de dispositivos y entrega por Expo

Estado: aceptado · Fecha: 2026-09-13

## Contexto

La app móvil ya pide el token de push en cada inicio de sesión y lo manda a
`POST /notifications/device-tokens`. **Ese endpoint no existía**: el registro
fallaba en silencio (`push.ts` traga el error a propósito para no romper el
arranque), así que ningún dispositivo estaba registrado en ninguna parte y el
canal no tenía a dónde entregar. El commit que añadió el registro en el móvil lo
dejó declarado: «Pendiente: registrar el token push en el backend y agregar el
adaptador de entrega por push (Expo Push API)».

El chat, mientras tanto, no avisa de nada fuera de la app: `ChatService` emite
por socket y nada más. Quien no tiene la app abierta no se entera de que le
escribieron hasta que la abre.

## Decisión

Tres piezas, ninguna nueva en su forma: el sistema de mensajería ya tenía puerto
de entrega, bandeja de salida transaccional y reintentos.

**1. `notifications.device_tokens`.** Un dispositivo por fila, identificado por
el token de Expo, que es único en toda la tabla y no por usuario: un teléfono
prestado no puede quedar registrado a dos cuentas a la vez o recibiría los
avisos de ambas. Registrar un token existente lo traslada a la cuenta que lo
registra. La baja marca `revoked_at` en vez de borrar, para que el siguiente
arranque de una app desinstalada no reinserte una fila limpia.

**2. `PUSH` como canal, con `ExpoPushNotificationAdapter`.** Expo es el
intermediario que habla con FCM y APNs usando las credenciales del proyecto de
EAS: en el backend no hay ninguna clave de Google ni de Apple, solo un endpoint
HTTPS y, opcionalmente, `EXPO_PUSH_ACCESS_TOKEN` si el proyecto activó la
seguridad de envío. Un aviso va a todos los dispositivos activos de la persona,
en peticiones de como mucho 100 mensajes (el tope que documenta Expo).

**3. Un productor real: el chat.** `persistMessage` —el único punto que escribe
un mensaje— encola un aviso PUSH para cada participante que no tenga un socket
abierto. Sin un productor, el canal sería código muerto.

## Consecuencias y decisiones de detalle

- **Quién está conectado no recibe push.** El socket ya le entregó el mensaje;
  mandarlo igual sería un doble aviso. La presencia es la del proceso
  (`ChatPresenceService`), así que con varias instancias de la API un usuario
  conectado a otra instancia sí recibiría push. Es el comportamiento aceptable
  del despliegue de una sola instancia que hay hoy; con más instancias la
  presencia tendría que ser compartida (Redis), y eso es otro cambio.
- **Un fallo del aviso no rompe el envío.** El mensaje ya está escrito y
  emitido; el push se registra como advertencia y se sigue.
- **"Sin dispositivos" no es un fallo.** Si la persona no tiene ninguno activo
  —o Expo responde `DeviceNotRegistered` para todos—, la entrega termina con
  `NO_ACTIVE_DEVICE` en vez de reintentar hasta la cola de muertos: reintentar
  no va a hacer aparecer un teléfono. Un fallo que sí puede dejar de darse
  (Expo caído, límite de frecuencia) sí propaga, y la bandeja de salida
  reintenta.
- **Expo declara tokens muertos y se retiran solos.** `DeviceNotRegistered`
  revoca esa fila en el acto; el resto del envío sigue.
- **El canal PUSH no aparece en la bandeja in-app.** Un mensaje de ese canal es
  una entrega a un dispositivo, no un elemento para leer dentro de la app: el
  chat ya muestra el mensaje en su sitio, y enseñarlo otra vez en la bandeja
  sería ruido. Quien quiera las dos cosas encola dos mensajes, uno por canal.
- **Apagado por defecto.** `PUSH_NOTIFICATIONS_ENABLED=false`: un despliegue sin
  credenciales de push en EAS no debe intentar enviar y acumular fallos.
- **La restricción de canal de `notifications.messages` hubo que ampliarla.**
  Es una lista cerrada y PostgreSQL no permite ampliar un `CHECK`: la migración
  la reemplaza entera. La reversión la devuelve como `NOT VALID`, igual que
  cuando se añadió `EMAIL`, para no tener que borrar avisos ya enviados.

## Alternativas descartadas

- **`expo-server-sdk` en el backend.** Es un envoltorio fino sobre un `POST`
  JSON: aporta el troceado de a 100 y poco más, y a cambio mete una dependencia
  con su propia cadena de suministro en el camino de entrega. El troceado son
  seis líneas y está cubierto por pruebas.
- **Hablar con FCM y APNs directamente.** Obligaría a guardar y rotar
  credenciales de Google y de Apple en el backend, y a mantener dos protocolos
  distintos, cuando las credenciales ya viven en EAS porque el binario se
  construye ahí.
- **PUSH como canal preferido de las preferencias.** El push no sustituye al
  aviso in-app, lo acompaña: son dos entregas distintas del mismo hecho. La
  preferencia sigue eligiendo entre in-app y pasarela externa.
