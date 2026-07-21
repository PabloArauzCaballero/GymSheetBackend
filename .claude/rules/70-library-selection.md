# Selección de librerías

- Prohibido instalar dos librerías para la misma responsabilidad sin un ADR en `docs/decisions/`.
- Antes de añadir una dependencia: justifica responsabilidad, mantenimiento, seguridad, licencia,
  rendimiento, costo de salida (lock-in) y compatibilidad con la versión fijada en el lockfile.
- No añadas dependencias no usadas. Elimina las que no se referencien en `src/` tras verificar que el
  build, el type-check y las pruebas siguen pasando.
- Conserva `yarn` como gestor; no mezcles con npm/pnpm.
- Para procedimiento completo, invoca la skill `library-selection`.
