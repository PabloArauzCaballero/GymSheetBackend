# Observabilidad

- Logs estructurados (objeto con `event`), con correlation ID por petición
  (`request-id.middleware.ts`) saneado contra inyección de cabeceras.
- En producción, el filtro de errores redacta detalles técnicos de los 5xx.
- Health real: `/health/live` (liveness, sin dependencias), `/health/ready` (readiness: PostgreSQL,
  estado de migraciones y Redis). Readiness devuelve 503 si el esquema está desactualizado o Redis
  configurado está caído; liveness permanece 200.
- **Los workers deben volcar sus logs** (`flushLogs()` en el bootstrap): un worker sin salida es
  inobservable. Verifica que access/reminders/notifications emiten arranque y `worker.shutdown_requested`.
- Métricas Prometheus en `/health/metrics` (protegibles con `METRICS_SCRAPE_TOKEN`).
- No registres secretos, tokens ni datos personales.
