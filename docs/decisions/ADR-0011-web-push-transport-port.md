# ADR-0011 — Puerto de transporte de push y adopción de web-push

Estado: aceptado · Fecha: 2026-09-16

## Contexto

Las notificaciones push existen desde `01441a0` y son **sólo móviles**: el
`InAppNotificationAdapter` llamaba a un `ExpoPushService` concreto, que manda los
tokens `ExponentPushToken[...]` a la API de Expo y deja que ella reenvíe por FCM
o APNs con las credenciales del proyecto de EAS. El portal web no recibía nada:
ni service worker, ni suscripción, ni una fila donde guardarla.

Cerrar esa brecha (fase F4 del plan de paridad, hueco H1) obliga a hablar el
protocolo Web Push, que **no se parece** al de Expo:

- La identidad de un destino no es un token opaco de un proveedor, sino una URL
  (`endpoint`) del servicio de push del navegador (FCM, Mozilla autopush, APNs
  web).
- El cuerpo viaja **cifrado extremo a extremo** con dos claves que sólo el
  navegador conoce (RFC 8291): `p256dh`, la clave pública P-256 del cliente, y
  `auth`, un secreto de 16 bytes.
- El servidor se identifica firmando un JWT ES256 con un par de claves propio
  (VAPID, RFC 8292).

La regla `70-library-selection` exige justificar cualquier dependencia nueva y
prohíbe dos librerías para la misma responsabilidad. La regla `30-security` exige
allowlist para toda URL saliente.

## Decisión

Tres decisiones que van juntas.

### 1. Un puerto de push, `PushTransport`, con dos adaptadores

`delivery/push.transport.ts` define el puerto; `ExpoPushTransport` y
`VapidWebPushTransport` lo implementan. Es el mismo patrón que
`MediaStorageProvider` (ADR-0007) y `MailTransport` (ADR-0009): el caso de uso
depende de la interfaz, y quién entrega de verdad es configuración.

El puerto recibe una **lista** de destinos por llamada, no uno. No es un detalle:
Expo acepta cien tokens en una petición y Web Push exige una por navegador
—porque cada cuerpo se cifra con las claves de esa suscripción—, y un puerto de
un destino por llamada habría convertido el lote de Expo en cien peticiones para
que el adaptador más caro no se notara.

Cada transporte declara qué `platforms` sabe alcanzar. El
`PushDispatcherService` construye con eso una tabla de rutas al arrancar y elige
transporte **por la plataforma de cada fila**, nunca por una variable global. La
razón es de producto, no técnica: el caso normal es una persona con el móvil y el
navegador a la vez, y una elección global apagaría uno de los dos. Dos
transportes que reclamen la misma plataforma detienen el arranque en vez de
resolverse por orden de registro.

### 2. Una sola tabla de dispositivos, con la identidad en una columna

Migración `202609160001-web-push-device-tokens`.

`device_tokens.expo_push_token` pasa a llamarse `push_token` y ensancha a 500
caracteres. Guarda «la cadena opaca que el transporte necesita para llegar a este
dispositivo»: el token de Expo en ANDROID/IOS, la URL del `endpoint` en WEB. Lo
único específico de Expo era el nombre de la columna; el UNIQUE sigue siendo uno
y sigue significando lo mismo —un destino, una fila—.

Las claves de cifrado, que **no** tienen equivalente en Expo, van en columnas
propias nulables (`p256dh`, `auth`) y no en un `jsonb` genérico: son obligatorias
y de forma fija para WEB, un CHECK puede exigirlas, y una clave suelta dentro de
un JSON no la exige nadie. El CHECK es simétrico —WEB obliga a tenerlas,
ANDROID/IOS obliga a NO tenerlas— para que la tabla no pueda alcanzar un estado
en el que el worker tenga que adivinar por qué camino sale una fila.

Alternativas descartadas:

- **Tabla aparte para las suscripciones web.** Habría duplicado `user_id`,
  `active` y `last_seen_at`, y sobre todo el fan-out: el despachador tendría que
  preguntar dos veces y unir en memoria justo lo que el modelo acababa de
  separar.
- **Serializar la suscripción entera en `expo_push_token`.** Cabe en 200
  caracteres a duras penas, rompe el UNIQUE por endpoint y deja el esquema sin
  forma de validar nada.
- **Conservar `expo_push_token` y añadir `endpoint` nulable.** Dos columnas de
  identidad admiten filas con las dos llenas o las dos vacías, y obligan a cada
  consulta a saber cuál mirar.

El **contrato HTTP del móvil no cambia**: `POST /notifications/device-tokens`
sigue aceptando `{ expoPushToken, platform }`. El cuerpo del navegador es otra
rama de una unión discriminada por `platform`, con `endpoint` y `keys`.

### 3. `web-push` como implementación de VAPID

| Criterio | Evaluación |
|---|---|
| Responsabilidad | Protocolo Web Push y nada más: cifrado RFC 8291, firma VAPID RFC 8292, petición al servicio de push. No arrastra plantillas, colas ni ORM. |
| Versión | 3.6.7, la del lockfile. `engines: node >= 16`; este repo fija `>=20 <24`. |
| Mantenimiento | Es la implementación de referencia de la organización `web-push-libs`. Publica poco porque el protocolo está congelado en RFCs, no porque esté abandonada: superficie de API estable desde la 3.x. |
| Seguridad | Confina la criptografía (ECDH P-256, HKDF, AES-128-GCM, JWT ES256) en una librería auditada. Cinco dependencias transitivas, todas MIT salvo la propia. |
| Licencia | MPL-2.0. Copyleft **por archivo**: usarla como dependencia sin modificar sus fuentes no afecta a la licencia de este proyecto. Si algún día hubiera que parchearla, el parche se publica; por eso vive detrás del puerto y no se toca. |
| Rendimiento | Una petición HTTPS por suscripción, que es lo que el protocolo permite. `timeout` y `TTL` son parámetros, no constantes ocultas. |
| Costo de salida | Bajo: confinada a `vapid-web-push.transport.ts`. Cambiarla no toca dominio ni caso de uso. |

Alternativas descartadas:

- **Implementar RFC 8291 + 8292 a mano sobre `node:crypto`.** Es criptografía
  aplicada —derivación HKDF con el contexto exacto, relleno, `aes128gcm` frente
  al `aesgcm` heredado—, donde un error no falla: entrega cuerpos que el
  navegador descarta en silencio. Asumir ese mantenimiento para no depender de
  una librería es un mal negocio.
- **Un SDK de proveedor (Firebase Admin, OneSignal).** Ata el despliegue a una
  empresa y a una consola, cuando Web Push es un estándar que todos los
  navegadores implementan directamente. Además duplicaría la responsabilidad que
  Expo ya cubre en móvil.
- **Reutilizar la pasarela HTTP firmada.** Es un webhook a un sistema nuestro,
  no un cliente de un protocolo de terceros con cifrado extremo a extremo.

## Seguridad: el endpoint lo elige el cliente

Una suscripción llega en el cuerpo de una petición autenticada, pero su
`endpoint` lo decide el navegador: para el servidor es **una URL arbitraria
enviada por un cliente**, exactamente la forma de un SSRF. Sin filtro, registrar
`http://169.254.169.254/...` bastaría para que el backend llamara a la red
interna cada vez que se emite un aviso.

Por eso hay una allowlist de hosts de servicios de push
(`WEB_PUSH_ALLOWED_HOSTS`, con el mismo criterio que
`NOTIFICATION_GATEWAY_ALLOWED_HOSTS`), HTTPS obligatorio, y la comprobación se
aplica **dos veces**: al dar de alta, y otra vez justo antes de abrir la conexión
—porque una fila ya guardada puede haber quedado fuera si el despliegue redujo la
lista—.

## Configuración

`WEB_PUSH_TRANSPORT` = `DISABLED` (por defecto) o `VAPID`, más `VAPID_SUBJECT`,
`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `WEB_PUSH_ALLOWED_HOSTS`,
`WEB_PUSH_TIMEOUT_MS` y `WEB_PUSH_TTL_SECONDS`.

Sin fallback silencioso: `createWebPushTransport` detiene el arranque si se pide
`VAPID` sin claves o con la allowlist vacía, y dice qué variable falta y cómo
generar el par. `DISABLED` no es un fallo sino una decisión explícita: el
despachador se queda sin ruta para WEB, `GET /notifications/push/web-config`
responde `enabled: false` y el alta de una suscripción web responde 503 con ese
motivo, en vez de guardar una fila que no sonaría nunca.

La clave pública se sirve desde el backend
(`GET /notifications/push/web-config`) en lugar de duplicarse en una variable del
front: es la mitad pública de un par que vive aquí, dos copias acaban
divergiendo, y una pública que no corresponde a la privada produce suscripciones
que el servicio de push rechaza sin explicar por qué.

## Consecuencias

- Una dependencia de producción más, acotada a un archivo.
- El móvil no cambia de comportamiento: mismo contrato, mismo lote de cien, misma
  baja por `DeviceNotRegistered`. Lo que cambia es que ahora esa baja la decide
  el despachador a partir de un resultado del transporte, y no el transporte
  tocando el repositorio.
- Añadir un medio de push futuro (una app de escritorio, otro proveedor) es
  implementar `PushTransport` y declarar sus plataformas: ni el caso de uso ni el
  esquema se enteran.
- Rotar el par VAPID invalida todas las suscripciones de navegador existentes: el
  navegador ata cada una a la clave pública con la que se creó. Es una operación
  de despliegue, no de mantenimiento rutinario.
