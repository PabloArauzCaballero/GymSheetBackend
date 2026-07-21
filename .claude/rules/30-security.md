# Seguridad

- Trata toda entrada externa como no confiable: valida con Zod (esquemas `*.schemas.ts`), que además
  descarta campos no declarados (protección contra mass assignment).
- Autenticación: JWT HS256, revalidación del principal contra la base de datos en cada petición.
  Contraseñas con bcrypt; el login gasta un `compare` incluso sin cuenta (anti-enumeración temporal).
- Autorización: guards en el backend + propiedad por recurso. Acceso ajeno → 404.
- Los errores no exponen detalles internos (stack, SQL, credenciales). No registres datos sensibles
  ni payloads completos en logs.
- Secretos solo por variables de entorno. Nunca en el repositorio ni en logs. Solo `.env.example`
  se versiona.
- Rate limiting compartido vía Redis en multi-instancia (`REDIS_URL` + `REDIS_REQUIRED`). Las sondas
  de health nunca dependen del backend de rate limiting.
- Valida URLs salientes contra allowlist (SSRF). CORS restringido por allowlist de orígenes.
- Endpoints administrativos y de métricas: autenticados o restringidos a red privada
  (`METRICS_SCRAPE_TOKEN`).
