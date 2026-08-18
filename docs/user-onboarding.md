# Onboarding de usuario

`profile.onboarding` es la fuente de verdad. Conserva estado `NOT_STARTED`, `IN_PROGRESS`, `COMPLETED` o `REQUIRES_UPDATE`, paso actual, pasos completados, versión, timestamps y campos pendientes.

Endpoints autenticados: `GET /me/onboarding`, cuatro `PUT` por sección y `POST /me/onboarding/complete`. Cada paso guarda progreso; completar valida objetivo, medidas, experiencia, frecuencia, lugar y consentimientos. La operación final es transaccional e idempotente y actualiza la proyección antropométrica heredada.

El guard frontend se aplica a clientes. Una caída del endpoint bloquea con reintento; administradores y personal no son enviados al onboarding de atleta.
