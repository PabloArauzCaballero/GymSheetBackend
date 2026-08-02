# Historial de mediciones corporales

`profile.body_measurements` conserva usuario, peso, unidad, fecha, fuente, creador y fecha de registro. Una clave idempotente opcional evita duplicar reintentos.

`GET /me/body-measurements` devuelve el historial y `POST /me/body-measurements` añade una medición. El perfil mantiene una proyección reciente en kg/cm sin reemplazar el historial. Los logs registran IDs y pasos, no valores corporales.
