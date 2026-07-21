---
paths:
  - "src/**/*.spec.ts"
  - "test/**/*.ts"
---

# Pruebas

- No declares corregido un problema sin una prueba o evidencia verificable. Para cada corrección de
  defecto, la prueba debe **fallar contra el código original** y pasar contra el corregido.
- Unitarias con dobles; e2e reales contra PostgreSQL (`test/*.e2e-spec.ts`, puerto 5433).
- No elimines pruebas ni reduzcas aserciones para lograr un build verde.
- Cubre los caminos negativos: 401 sin token, 403/404 por autorización, 400 por entrada inválida,
  409 por conflicto, aislamiento horizontal entre cuentas.
- Los gates (lint, type-check, test) no bastan para código que se despliega: verifica también el
  arranque real y el comportamiento ante fallo de dependencias.
