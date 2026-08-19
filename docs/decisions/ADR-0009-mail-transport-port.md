# ADR-0009 — Puerto de transporte de correo y adopción de nodemailer

Estado: aceptado · Fecha: 2026-08-19

## Contexto

La recuperación de contraseña necesita entregar un PIN al correo del usuario.
Hasta ahora el sistema no enviaba correo por ningún camino: la mensajería tenía
un puerto de entrega (`NotificationDeliveryAdapter`) con adaptadores para avisos
dentro de la app, una pasarela HTTP firmada y un simulacro, pero ninguno hablaba
SMTP.

La regla `70-library-selection` exige justificar cualquier dependencia nueva
antes de añadirla, y prohíbe dos librerías para la misma responsabilidad.

## Decisión

Añadir un **puerto propio** para el correo, `MailTransport`, con dos
adaptadores, y usar **nodemailer** como implementación del transporte SMTP.

El puerto es deliberadamente más estrecho que el de mensajería: habla de
direcciones y texto, no de usuarios ni de canales del dominio. Esa frontera es
la que permite sustituir SMTP por un proveedor de API —SES, Resend, lo que sea—
tocando un archivo, y es la razón por la que la dependencia queda confinada a
`smtp-mail.transport.ts` y no aparece en ninguna otra parte del código.

Los dos adaptadores:

- `LogMailTransport` escribe el mensaje completo en el registro. Existe para que
  el flujo de recuperación se pueda recorrer entero en local sin un servidor de
  correo. Sin él, probar «olvidé mi contraseña» exigiría configurar un buzón
  real, y lo que ocurre entonces es que nadie lo prueba.
- `SmtpMailTransport` envía de verdad.

`env` prohíbe el transporte de registro en producción: imprime el PIN, y un PIN
en los registros es una credencial en los registros.

## Por qué nodemailer

- **Responsabilidad**: SMTP, y nada más. No arrastra plantillas, colas ni un
  cliente de proveedor.
- **Mantenimiento**: es la librería de correo de facto en Node desde hace más de
  una década, con versiones publicadas de forma continuada.
- **Seguridad**: soporta STARTTLS y TLS directo, y expone los tiempos de espera
  que necesitamos para no dejar colgada la petición de un usuario contra un
  servidor que no responde.
- **Licencia**: MIT, compatible con el resto del proyecto.
- **Rendimiento**: mantiene un grupo de conexiones; el transporte se construye
  una sola vez, porque lo caro de mandar un correo no es el correo sino la
  negociación TLS.
- **Costo de salida**: bajo por diseño. La dependencia vive detrás del puerto, y
  cambiarla no toca ni el dominio ni el caso de uso.

## Alternativas descartadas

- **Hablar SMTP a mano.** El protocolo es simple hasta que aparecen STARTTLS,
  autenticación y codificación de cabeceras. Escribir eso es asumir el
  mantenimiento de una librería a cambio de no depender de una.
- **Un SDK de proveedor concreto.** Ata el despliegue a una empresa antes de
  saber cuál usará cada gimnasio. Cuando haga falta, será otro adaptador detrás
  del mismo puerto, no una sustitución.
- **Reutilizar la pasarela HTTP existente.** Es una pasarela firmada para avisos
  push, no un servidor de correo. Forzarla habría mezclado dos medios con
  garantías distintas bajo un solo adaptador.

## Consecuencias

- Una dependencia de producción más, acotada a un archivo.
- El canal `EMAIL` entra en la mensajería como un adaptador más: para el
  servicio de entrega, mandar un correo y guardar un aviso en la app son la
  misma operación. Añadir un medio no cambia una línea del caso de uso.
- Los correos heredan las garantías que ya tenía la mensajería —outbox
  transaccional, reintentos con backoff, cola de fallidos— sin código nuevo.
