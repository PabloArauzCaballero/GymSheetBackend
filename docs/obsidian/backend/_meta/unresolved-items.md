# Unresolved items

Registro de incertidumbres del bootstrap (rev 27f3fd2). Actualizar conforme se confirme.

## U-001 — Mapeos de puertos exactos
- Estado: `NO_CONFIRMADO`
- Falta: puertos publicados en `docker-compose.yml` / `docker-compose.dev.yml`.
- Acción: revisar sección `ports:` de cada servicio. Ver [[15-reference/ports]].

## U-002 — Estrategia de versionado de API
- Estado: `NO_CONFIRMADO`
- Falta: evidencia de versionado (prefijo/versión) más allá de `API_PREFIX`.
- Acción: confirmar en `main.ts`/`app.module.ts`. Ver [[04-api/versioning]].

## U-003 — Paginación por defecto en listados
- Estado: `INFERIDO`
- Falta: confirmar límites/params de paginación por endpoint.
- Acción: revisar schemas de query. Ver [[04-api/pagination-filtering-sorting]].

## U-004 — SLIs/SLOs formales
- Estado: `NO_CONFIRMADO`
- Falta: definición de objetivos de servicio.
- Acción: derivar de métricas expuestas. Ver [[09-observability/slo-sli-sla]].

## U-005 — Cobertura de pruebas real (instrumentada)
- Estado: `NO_CONFIRMADO`
- Falta: ejecutar `jest --coverage`.
- Acción: medir antes de afirmar cobertura. Ver [[11-quality/coverage-gaps]].
