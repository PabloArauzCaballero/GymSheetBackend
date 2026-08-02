# Tienda de membresías

`GET /membership/plans` entrega precio/moneda desde PostgreSQL, beneficios e imagen. `GET /me/membership/options` ofrece altas/renovaciones sin vigencia y extensiones compatibles del mismo plan para membresías activas.

Los POST de renovación/extensión requieren `idempotencyKey` y crean una intención, no una compra ficticia. La respuesta declara `accessGranted: false` y entrega la acción WhatsApp controlada por backend.
