# Renovación por WhatsApp

El número proviene exclusivamente de `WHATSAPP_MEMBERSHIP_PHONE` y acepta entre 8 y 15 dígitos con código de país. Para el entorno corporativo actual se configura `59177377232` (`591` Bolivia + `77377232`). El mensaje exacto es `Hola, quisiera renovar mi membresía` y se codifica con `encodeURIComponent`.

La acción registra una intención idempotente y `membership.whatsapp_renewal_started` con IDs, estado, timestamp y correlation ID. No registra conversaciones ni concede acceso.
