# Onboarding de usuario

`profile.onboarding` es la fuente de verdad. Conserva estado `NOT_STARTED`, `IN_PROGRESS`, `COMPLETED` o `REQUIRES_UPDATE`, paso actual, pasos completados, versión, timestamps y campos pendientes.

Endpoints autenticados: `GET /me/onboarding`, cuatro `PUT` por sección y `POST /me/onboarding/complete`. Cada paso guarda progreso; completar valida objetivo, medidas, experiencia, frecuencia, lugar y consentimientos. La operación final es transaccional e idempotente y actualiza la proyección antropométrica heredada.

Paso opcional **Conocer** (`socialStep`: `PENDING`, `DONE` o `SKIPPED`, expuesto en `GET /me/onboarding`): `PUT /me/onboarding/social` con `{ "action": "DONE" | "SKIP" }`. Se puede saltar y retomar después (un `DONE` posterior reemplaza a `SKIPPED`; `SKIP` nunca deshace `DONE`) y **no** bloquea `POST /me/onboarding/complete`. Las respuestas del paso viven en `GET/PUT /me/social-profile` (intereses del catálogo `GET /social/catalog/interests`, hábitos, bio y orientación opcional, oculta por defecto) y «Qué buscas» son las `intents` de `PUT /me/discovery/preferences`, que incluyen `UNSURE` («Aún no lo sé»). `GET /me/discovery/readiness` dice qué falta para aparecer en Conocer.

El guard frontend se aplica a clientes. Una caída del endpoint bloquea con reintento; administradores y personal no son enviados al onboarding de atleta.
