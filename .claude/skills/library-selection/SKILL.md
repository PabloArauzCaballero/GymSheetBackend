---
name: library-selection
description: Selecciona o justifica añadir una librería con una matriz de compatibilidad, mantenimiento, seguridad, licencia, rendimiento, costo de salida y evidencia oficial. Prohíbe instalar dos librerías para la misma responsabilidad sin ADR, y detecta/elimina dependencias no usadas. Úsala antes de añadir cualquier dependencia.
---

# library-selection

## Propósito
Evitar dependencias injustificadas, duplicadas o no usadas.

## Cuándo usarla
Antes de `yarn add`; al revisar `package.json` en una auditoría.

## Cuándo NO usarla
Para actualizaciones de parche dentro del mismo rango semver.

## Fuentes obligatorias
`package.json`, `yarn.lock`, `docs/decisions/`, `.claude/rules/70-library-selection.md`.

## Entradas requeridas
Responsabilidad a cubrir o la dependencia candidata.

## Condiciones para detenerse
Cambio de versión mayor o de stack → requiere ADR y aprobación.

## Flujo por fases
1. ¿Ya existe una librería para esta responsabilidad? Si sí, no añadas otra sin ADR.
2. Matriz: alternativas · versión · compatibilidad (Node/Nest) · mantenimiento · seguridad · licencia
   · rendimiento · lock-in · estrategia de salida.
3. Verifica documentación de la versión fijada en el lockfile.
4. Detección de no usadas: `grep -rl "<paquete>" src/`. Si 0 usos, propón eliminación y **verifica**
   con `yarn type-check && yarn lint && yarn test && yarn build`.
5. Registra la decisión (ADR si es estructural).

## Comandos permitidos
`yarn add`/`remove` (tras decisión), `yarn audit:prod`, `type-check`, `lint`, `test`, `build`.

## Comandos prohibidos
Cambiar de gestor de paquetes; añadir dependencia duplicada sin ADR; eliminar sin verificar gates.

## Evidencia requerida
Matriz + gates verdes tras el cambio.

## Entregables
Matriz de decisión y, si aplica, ADR + actualización de `package.json`/`yarn.lock`.

## Formato de respuesta
Tabla de decisión (Instalar/Conservar/Eliminar/Descartar + justificación).

## Lista de verificación final
Sin duplicación de responsabilidad; sin dependencias no usadas; gates verdes; ADR cuando corresponda.

## Limitaciones
Sin CLI `claude` no se usa `context7`; documentación oficial se consulta manualmente.

## Trazabilidad
`programacionBackend.md` (aportado). Aplicada en esta auditoría para eliminar `class-transformer` y
`@nestjs/config` (no usados) — ver `docs/decisions/ADR-0003`.
