---
name: production-verification
description: Verifica que un cambio funciona de verdad antes de declararlo terminado. Ejecuta instalación, type-check, lint, pruebas unitarias y e2e, build, arranque real y comprobación de comportamiento ante fallo de dependencias. Úsala antes de cerrar cualquier fase o PR. No afirma "listo" si una comprobación crítica no pudo ejecutarse.
---

# production-verification

## Propósito
Convertir "compila" en "funciona y es desplegable", con evidencia.

## Cuándo usarla
Antes de declarar terminada una fase, cerrar un PR o afirmar preparación para producción.

## Cuándo NO usarla
Durante la exploración temprana; no es un sustituto de escribir pruebas.

## Fuentes obligatorias
`package.json` (scripts), `Dockerfile`, `docker-compose.yml`, `.github/workflows/hardening-ci.yml`.

## Entradas requeridas
Rama con el cambio; PostgreSQL (:5433) para e2e; opcional Redis y Docker para verificación de pila.

## Condiciones para detenerse
Falta una dependencia crítica (BD, Docker); documenta qué no se pudo ejecutar y el procedimiento exacto.

## Flujo por fases
1. `yarn install --frozen-lockfile`
2. `yarn type-check` · `yarn lint`
3. `yarn test` (unitarias)
4. `yarn test:e2e` (requiere PostgreSQL)
5. `yarn build` + **verificar artefacto**: existen `dist/main.js`, `dist/database/migrate.js`, los tres
   `dist/workers/*.worker.js`, y **no** existe `dist/src/` (regresión F-012).
6. Arranque real en puerto libre: `/health/live` y `/health/ready` = 200.
7. Prueba de fallo: detener Redis/PostgreSQL y confirmar que liveness sigue 200, readiness 503, y los
   endpoints de negocio no devuelven 500 (F-014). Workers emiten logs (F-015).
8. (Opcional) `docker compose up -d --build` y repetir 6-7 en contenedor.

## Comandos permitidos
Los anteriores; `docker compose`; arranque en puerto no ocupado.

## Comandos prohibidos
Ejecutar contra producción; `--passWithNoTests`; reducir aserciones para pasar.

## Evidencia requerida
Salida real de cada paso, con conteos de pruebas y códigos HTTP observados.

## Entregables
Tabla de gates con resultado real y lista explícita de lo no ejecutado (con motivo y procedimiento).

## Formato de respuesta
Tabla ✅/❌ por comprobación + limitaciones.

## Lista de verificación final
Ningún gate omitido; artefacto de build verificado; arranque y sondas reales; comportamiento ante
fallo de dependencia comprobado cuando aplique.

## Limitaciones
En Windows, SIGTERM y `/proc` (RSS de carga) se verifican en contenedor/CI.

## Trazabilidad
Criterios de aceptación de `programacionBackend.md` (aportado) y §9 de la auditoría.
