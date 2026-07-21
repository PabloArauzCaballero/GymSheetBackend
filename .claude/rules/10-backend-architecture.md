---
paths:
  - "src/**/*.ts"
---

# Arquitectura backend (NestJS)

- Capas: controller (transporte) → service (reglas de dominio + propiedad) → repository (acceso a
  datos). No mezcles transporte HTTP con reglas de negocio.
- No devuelvas modelos Sequelize directamente desde un controlador: usa los `*.mapper.ts`.
- La autorización se aplica en el backend (guards globales `JwtAuthGuard`, `RolesGuard` + verificación
  de propiedad en el servicio). El acceso a un recurso ajeno responde **404, no 403**.
- Toda operación multi-tabla que deba ser atómica usa una transacción de Sequelize.
- El trabajo asíncrono va por el outbox transaccional (`integration.outbox_jobs`) + workers, con
  reintentos finitos, backoff y dead-letter. No introduzcas colas externas sin ADR.
- Idempotencia: los conflictos de unicidad se traducen a `ConflictException` (409), no a 500.
