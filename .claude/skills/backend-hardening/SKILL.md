---
name: backend-hardening
description: Auditoría y endurecimiento por fases del backend (seguridad, integridad de datos, observabilidad, rendimiento, pruebas, despliegue). Úsala cuando se pida auditar, endurecer o preparar el proyecto para producción, o revisar todo el proyecto contra las reglas. Produce hallazgos con evidencia ejecutada y correcciones verificadas.
---

# backend-hardening

## Propósito
Auditar el backend por fases y **corregir** lo corregible desde el código, con evidencia ejecutada.

## Cuándo usarla
Peticiones de auditoría, hardening, "revisa y corrige el proyecto", preparación para producción.

## Cuándo NO usarla
Para un cambio puntual usa el flujo normal + `production-verification`. Para revisar solo un diff usa
`clean-code-review` o `/code-review`.

## Fuentes obligatorias
`BACKEND_AUDIT_HARDENING_AND_ACTION_PLAN.md`, `.claude/rules/`, código y pruebas reales, CI
(`.github/workflows/hardening-ci.yml`).

## Entradas requeridas
Rama de trabajo limpia o con cambios conocidos; acceso a PostgreSQL (:5433) y opcionalmente Redis
para las fases que lo requieran.

## Condiciones para detenerse
Contradicción crítica; necesidad de secretos, OAuth, producción, `git push` o migración destructiva;
dependencia externa ausente. Detente solo en ese punto y continúa con lo no bloqueado.

## Flujo por fases
0. Línea base: `yarn lint`, `yarn type-check`, `yarn test`, `yarn build`, `yarn audit:prod`.
1. Seguridad crítica → 2. Integridad de modelo y alcance → 3. Ingesta/integración →
4. Rendimiento → 5. Clean Code y arquitectura → 6. Observabilidad → 7. Resiliencia/concurrencia →
8. Despliegue → 9. Pruebas integrales (incluida ejecución real y prueba de fallo de dependencias) →
10. Documentación.
Cada hallazgo: evidencia, ruta, severidad, impacto, corrección, prueba de regresión, estado.

## Comandos permitidos
Los de `CLAUDE.md`, `docker compose`, arranque local en puerto libre, `migration:up/down` sobre BD de
prueba desechable.

## Comandos prohibidos
Migraciones o `docker` contra producción; `git push`; borrado de datos históricos; desactivar pruebas
o reglas para lograr verde.

## Evidencia requerida
Salida real de cada gate; para cada corrección, la prueba que falla sin el fix y pasa con él;
verificación de arranque real y de comportamiento ante caída de dependencia cuando aplique.

## Entregables
Hallazgos corregidos + pruebas nuevas + actualización de `BACKEND_AUDIT_HARDENING_AND_ACTION_PLAN.md`.

## Formato de respuesta
Resumen ejecutivo · matriz de hallazgos · antes/después · riesgos restantes · decisión de producción
sustentada.

## Lista de verificación final
Gates verdes; vulnerabilidades críticas corregidas o bloqueantes; permisos en backend; ingesta
idempotente; trazabilidad y datos crudos preservados; reintentos finitos; logs estructurados y
saneados; health/readiness/liveness reales; graceful shutdown; migraciones reproducibles; sin
secretos en Git; errores sin fuga interna.

## Limitaciones
En Windows el apagado por SIGTERM se verifica en contenedor/CI. Sin CLI `claude` no se instalan
plugins.

## Trazabilidad
Deriva de `programacionBackend.md` (aportado en conversación) y de la auditoría ya ejecutada.
