# Rendimiento y eficiencia

- Mide antes de optimizar: baseline, p50/p95/p99, comparación antes/después. No aceptes
  optimizaciones sin evidencia (existe `test/load/http-load-smoke.mjs` con presupuesto).
- Listados siempre paginados e indexados. Nada de paginación en memoria ni `SELECT *` innecesario.
- Evita N+1: carga relaciones de forma explícita y acotada.
- Lecturas grandes por lotes acotados (ver `ExportService`: tope de exportación síncrona). El trabajo
  masivo va a un job asíncrono, no a un payload en memoria sin límite.
- Pool de conexiones y statement timeout configurados por entorno; no los relajes sin justificación.
- Redis solo cuando el sistema realmente lo use; diseña TTL, invalidación y límite de memoria.
- No microoptimices mientras existan problemas de diseño, seguridad o consultas.
