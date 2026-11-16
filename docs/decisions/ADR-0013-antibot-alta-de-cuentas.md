# ADR-0013 — Capa anti-bot del alta de cuentas

Estado: aceptado · Fecha: 2026-11-16

## Contexto

`POST /auth/register` es público y devuelve sesión. Hasta ahora lo único que frenaba un alta
automatizada era el limitador global (`AUTH_RATE_LIMIT_MAX` por minuto). La decisión de producto es
un anti-bot «al nivel más alto» con dos condiciones: que lo que no necesita cuenta externa quede
**activo por defecto**, y que lo de terceros esté programado pero **apagado por flag** hasta que
existan credenciales. Al cliente nunca se le dice por qué se rechazó un alta: el motivo se registra
y se audita, la respuesta es siempre `400 SIGNUP_REJECTED` con un texto genérico.

## Decisión

Un módulo `src/modules/antibot` con un contrato fijo (`signup-protection.types.ts`): auth arma un
`SignupContext`, `SignupProtectionService.evaluate()` devuelve un veredicto y, si se aceptó,
`recordOutcome()` lo persiste **dentro de la transacción del alta**. Ninguno toca las tablas del otro.

### Capas

| # | Capa | Estado por defecto | Efecto |
|---|---|---|---|
| 1 | Ticket de formulario `GET /auth/register/ticket`: `base64url({id, iat}).HMAC-SHA256`, 60 min, un solo uso, tiempo mínimo de llenado medido en el servidor | **Activa** | `TICKET_MISSING`, `TICKET_INVALID`, `TICKET_REUSED`, `TOO_FAST` |
| 2 | Honeypot (`website`) | **Activa** | `HONEYPOT` |
| 3 | Cloudflare Turnstile (sólo `WEB`) | Apagada sin `TURNSTILE_SECRET` | `TURNSTILE_FAILED`; caída → riesgo (o rechazo con `TURNSTILE_FAIL_CLOSED`) |
| 4 | Atestación móvil, nonce `GET /auth/attestation/challenge` (10 min, un uso) + Play Integrity | Apagada (`ATTESTATION_ENABLED`) | Android: `ATTESTATION_FAILED`; iOS: sólo riesgo |
| 5 | Velocidad: 5/h por IP, 3/día por instalación, 30/h por dominio no exento | **Activa** | `RATE_LIMITED` |
| 6 | Dominios desechables (`data/disposable-domains.txt`, dominio y subdominios) | **Activa** | `DISPOSABLE_EMAIL` |
| 7 | Contraseña filtrada (HIBP, k-anonimato, `Add-Padding`) | Apagada (`PASSWORD_BREACH_CHECK_ENABLED`) | Sólo riesgo `BREACHED_PASSWORD` |
| 8 | Riesgo: `LOW`; `MEDIUM` con una señal blanda; `HIGH` con dos o más | **Activa** | `riskReasons` |

Señales blandas: `TICKET_ABSENT` (con `SIGNUP_TICKET_REQUIRED=false`), `IP_VELOCITY` (≥ 3 altas en
la hora), `AUTOMATION_USER_AGENT` (headless, librerías HTTP o sin UA; `okhttp` excluido a
propósito porque es la pila de React Native en Android), `TURNSTILE_UNAVAILABLE`,
`ATTESTATION_MISSING`, `ATTESTATION_UNVERIFIED`, `ATTESTATION_UNAVAILABLE`, `BREACHED_PASSWORD`.

El orden es deliberado: primero lo local y barato, los límites antes de cualquier llamada remota,
para que un ataque no se convierta en tráfico pagado hacia Cloudflare o Google.

### Almacenamiento

- **Tickets y nonces: PostgreSQL, sin Redis.** Son valores firmados **sin estado** hasta que se
  usan: emitirlos no escribe nada, así que inundar los endpoints públicos no hace crecer ninguna
  tabla. `auth.signup_tickets` es un libro de tokens **gastados**; su clave primaria convierte dos
  envíos concurrentes del mismo ticket en un solo ganador. Se eligió la base y no Redis porque el
  gasto del ticket tiene que confirmarse **en la misma transacción** que crea la cuenta: si el alta
  falla (correo repetido), el ticket sigue sirviendo; si dos envíos compiten, uno recibe 409.
  Un rechazo también quema el ticket que traía.
- **Contadores de velocidad: Redis si está configurado, contadores por proceso si no**, la misma
  política que el limitador global (`ResilientThrottlerStorage`): una caída de Redis degrada, no
  bloquea todas las altas. Las claves son HMAC, nunca la IP ni el dominio en claro.
- **Auditoría: `auth.signup_audit`**, de sólo inserción, con fila también para cada rechazo
  (`user_id` nulo). La IP se guarda sólo como HMAC con `IP_HASH_SECRET` (sin él, nula).

### Observabilidad, moderación y retención

- Logs `signup.rejected{reason, risk, channel}` y `signup.accepted{risk, riskReasons, channel}`
  (este, tras el commit), sin correo, IP ni tokens.
- Contador `gym_sheet_signup_verdicts_total{outcome, reason, risk}` en `/health/metrics`, mediante
  un `CounterRegistry` global de etiquetas acotadas.
- `GET /admin/signups?risk=&limit=` (hoy sólo `MODERATOR` y `SYSTEM_ADMIN`, ADR-0018; antes `ADMIN` + `moderation:read`, igual que la cola de
  moderación). Un `MODERATOR` o un `SYSTEM_ADMIN` sin suplantar ve todo, rechazos incluidos; un
  `SYSTEM_ADMIN` que suplanta ve las altas aceptadas de ese gimnasio. Nunca se expone `ip_hmac`.
- `yarn db:signups:retention` (un solo disparo, como `db:outbox:prune`; programarlo a diario):
  borra tokens gastados de más de 1 día y anula `ip_hmac` de auditorías de más de 90 días.
  Desde la franja 4 es un alias de `yarn db:privacy:retention`, que además anula el HMAC de IP en
  todas las tablas que lo guardan ([ADR-0014](ADR-0014-privacidad-retencion-y-consentimientos.md)).

### Salidas a terceros

Todas las URL son constantes y pasan por `fetchAllowlisted`: https, host en una allowlist fija
(`challenges.cloudflare.com`, `playintegrity.googleapis.com`, `oauth2.googleapis.com`,
`api.pwnedpasswords.com`), sin redirecciones y con timeout. El token OAuth de Google se obtiene con
el flujo JWT bearer firmado con `node:crypto` (RS256): **ninguna dependencia nueva**.

## Lo que queda apagado o fuera

- **Turnstile**: hace falta crear el sitio en Cloudflare (site key al cliente web, secreto aquí).
- **Play Integrity**: hace falta el proyecto de Google Cloud vinculado en Play Console y una cuenta
  de servicio con la API habilitada. Al activarlo, el arranque exige paquete y credenciales.
- **iOS App Attest no se verifica en el servidor.** Hacerlo bien exige decodificar CBOR, validar la
  cadena X.509 hasta la raíz de Apple, la extensión del nonce, `rpIdHash` y guardar la clave por
  dispositivo para las aserciones siguientes; no cabe con seguridad en esta capa.
  `AppAttestVerifier` responde siempre `UNSUPPORTED` y en iOS la atestación es sólo señal de
  riesgo: ningún alta iOS se rechaza por un token que no se comprobó.
- **HIBP** no necesita cuenta, pero sale a un tercero en cada alta: se activa a conciencia.

## Consecuencias

- Los clientes deben pedir el ticket al abrir el formulario y mandarlo como `ticket`. Clientes
  viejos sin ticket se rechazan; `SIGNUP_TICKET_REQUIRED=false` existe para un corte deliberado.
- En producción el arranque falla sin `REGISTRATION_TICKET_SECRET`. Fuera de producción se usa un
  secreto aleatorio por proceso (tickets que mueren al reiniciar y no valen entre instancias).
- Las e2e heredadas registran sin ticket: `test/e2e-env.setup.ts` apaga la exigencia y sube los
  límites; `test/antibot-signup.e2e-spec.ts` la vuelve a encender y prueba el camino real.
