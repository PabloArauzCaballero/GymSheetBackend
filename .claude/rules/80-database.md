---
paths:
  - "src/database/migrations/**/*.ts"
  - "docs/db/**"
---

# Base de datos y migraciones

- **Nunca** `sync({ force: true })` ni `sync({ alter: true })`. El esquema se gestiona solo por
  migraciones versionadas en `src/database/migrations/` (registro en `src/database/migrations/index.ts`).
- Toda operación destructiva usa estrategia expand/contract y documenta rollback y compatibilidad.
- Los IDs de migración son inmutables tras el despliegue.
- Restricciones e índices se declaran en migración (unicidad, parciales, claves foráneas). La
  integridad la garantiza la base de datos, no solo el código de aplicación.
- No borres información histórica ni sobrescribas datos crudos; los historiales son append-only.
- Readiness verifica que las migraciones empaquetadas estén aplicadas (ver `40-observability`).
