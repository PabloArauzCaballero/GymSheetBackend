---
title: "REST · Export"
type: api
status: verified
last_reviewed: "2026-08-06"
source_revision: "27f3fd2"
tags: [backend, api]
---

# REST · Export

Controlador: `src/modules/export/export.controller.ts` (`@Controller('export')`) ·
Servicio: `export.service.ts`. En OpenAPI. Propiedad por usuario.

| Método | Ruta | Auth | Respuesta | Errores | Propósito |
|---|---|---|---|---|---|
| GET | `/export/workout-history` | Owner | JSON envelope | 413 | Exportación acotada del historial propio |
| GET | `/export/workout-history/csv` | Owner | `text/csv` | 413 | CSV descargable con neutralización de fórmulas |

Notas:

- La variante CSV fija cabeceras (`Content-Type: text/csv; charset=utf-8`,
  `Content-Disposition: attachment; filename="workout-history.csv"`) con `@Header`.
  El `ResponseInterceptor` **no envuelve** respuestas `text/csv` (cuerpo crudo) —
  ver [[04-api/conventions]].
- Lectura por lotes para acotar memoria; la exportación síncrona **rechaza**
  historiales por encima del límite duro configurado (413) en vez de materializar un
  payload sin límite (regla de rendimiento). El trabajo masivo iría a un job async.
- CSV: neutralización de fórmulas (anti CSV-injection) al prefijar celdas peligrosas.

Relacionado: [[workouts]] · [[04-api/error-model]] · [[03-domains/workouts/index]]
