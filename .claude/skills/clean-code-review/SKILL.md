---
name: clean-code-review
description: Revisión de Clean Code para TypeScript/NestJS. Detecta nombres pobres, funciones/clases con demasiadas responsabilidades, duplicación semántica, acoplamiento, anidamiento excesivo, errores silenciosos, comentarios que sustituyen diseño, abstracciones prematuras y falta de pruebas, sin imponer sobrearquitectura. Úsala sobre el diff reciente antes del commit.
---

# clean-code-review

## Propósito
Mejorar claridad y mantenibilidad del código modificado sin cambiar comportamiento.

## Cuándo usarla
Antes de commit/PR, sobre el diff reciente.

## Cuándo NO usarla
Para bugs usa `/code-review`/`debug`; para seguridad usa `security-audit`. No es un pretexto para
reescrituras masivas.

## Fuentes obligatorias
`.claude/rules/20-clean-code.md`, `eslint.config.mjs`, el diff a revisar.

## Entradas requeridas
El conjunto de archivos modificados.

## Condiciones para detenerse
Si una "mejora" cambiaría comportamiento o contratos públicos, detente y sepáralo como propuesta.

## Flujo por fases
1. Nombres (inglés técnico, sin ambigüedad).
2. Cohesión: funciones/clases de responsabilidad única; extraer lo que mezcla transporte y negocio.
3. Duplicación semántica → utilidad común solo si es genuina.
4. Anidamiento y booleanos ambiguos → early returns / enums.
5. Errores: nada de `catch` vacío ni promesas sin await (el lint los bloquea).
6. Abstracciones: eliminar las prematuras; no añadir capas sin problema real.
7. Pruebas: señalar lógica no cubierta.

## Comandos permitidos
`yarn lint`, `yarn type-check`, `yarn test`.

## Comandos prohibidos
Refactor masivo sin pruebas de regresión; cambios de comportamiento encubiertos como "limpieza".

## Evidencia requerida
`yarn lint` + `yarn type-check` + `yarn test` verdes tras los cambios.

## Entregables
Diff simplificado + justificación breve por cambio.

## Formato de respuesta
Lista de cambios con motivo; nada de reescritura estética disfrazada de mejora técnica.

## Lista de verificación final
Sin código muerto/imports sin usar/TODO colgados; gates verdes; comportamiento intacto.

## Limitaciones
Calidad, no búsqueda de bugs.

## Trazabilidad
Principios de Clean Code (Robert C. Martin) y `programacionGeneral.md` (aportado) — resumidos, no copiados.
