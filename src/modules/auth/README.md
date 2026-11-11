# auth

Responsable de registro, login, emisión de JWT y sesiones renovables.

- `POST /auth/login` y `POST /auth/register` devuelven `accessToken` (15 min) y `refreshToken`.
- `POST /auth/refresh` rota el refresh token (de un solo uso, ventana deslizante de
  `JWT_REFRESH_EXPIRES_IN`, 90 días por defecto). Reusar uno ya canjeado revoca la sesión.
- `POST /auth/logout` revoca la sesión del refresh token. Idempotente.
- Tabla `auth.refresh_tokens`: solo guarda el HMAC del token.

Las contraseñas se guardan con bcrypt y los endpoints privados se protegen con el guard JWT global.
