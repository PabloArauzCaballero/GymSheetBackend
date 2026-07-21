---
paths:
  - "src/**/*.ts"
---

# Clean Code (TypeScript)

- Tipado estricto. Prefiere `unknown` + validación antes que `any`. Evita aserciones de tipo
  innecesarias (el lint las bloquea).
- Nombres técnicos en inglés; mensajes visibles al usuario en español cuando corresponda.
- Funciones y clases cohesivas y de responsabilidad única. Evita anidamiento profundo y parámetros
  booleanos ambiguos.
- Sin código muerto, imports sin usar, `TODO`/`FIXME` colgados, `console.log` temporales ni `catch`
  vacíos (el lint los bloquea: `no-empty`, `no-console`, `no-floating-promises`).
- Centraliza errores (`HttpExceptionFilter`) y respuestas (`ResponseInterceptor`). No repliques.
- No sobre-abstraigas: cada patrón debe resolver un problema real identificado.
