---
title: "Autorización"
type: security
status: verified
criticality: high
last_reviewed: "2026-08-06"
source_revision: "27f3fd2"
source_files:
  - "src/common/guards/roles.guard.ts"
  - "src/common/guards/jwt-auth.guard.ts"
  - "src/app.module.ts"
  - "src/modules/workouts/workouts.service.ts"
  - "src/modules/membership/staff-branch-scope.model.ts"
tags: [backend, security, authorization, bola, bfla]
---

# Autorización

> Defensivo. La autorización se aplica **en el backend**, nunca en el cliente.

## Capas de control (VERIFICADO)

1. **Autenticación** — `JwtAuthGuard` global exige token válido y revalida el principal
   (ver [[08-security/authentication]]).
2. **Autorización de función (BFLA)** — `RolesGuard` global (`app.module.ts:98`) lee `@Roles(...)`
   por handler/clase. Si hay roles requeridos y el usuario no los tiene, responde **403**
   (`roles.guard.ts:24-28`). Sin `@Roles`, la ruta queda solo autenticada.
3. **Propiedad por recurso (BOLA / acceso horizontal)** — se verifica en la capa de servicio. El
   acceso a un recurso ajeno responde **404, no 403** (`workouts.service.ts:260,275,288` con
   `NotFoundException`). No revelar la existencia del recurso es intencional (regla
   `.claude/rules/30-security.md` y `10-backend-architecture.md`).

## Diferencia 403 vs 404 (por diseño)

- **403** — el usuario está autenticado pero su **rol** no alcanza para la operación (BFLA).
- **404** — el recurso existe pero **no pertenece** al usuario; se oculta su existencia (BOLA).

## Roles y scopes de staff

- Roles definidos en `domain.enums.ts` (`UserRole`), aplicados con `@Roles`.
- El dominio membership modela alcance de staff por sucursal y por plan:
  `staff-branch-scope.model.ts`, `plan-access-scope.model.ts`, `staff-profile.model.ts`. El staff
  opera sobre los recursos dentro de su scope; ver [[03-domains/membership/index]].

## Brechas / advertencias

- La verificación de propiedad depende de que **cada** servicio la implemente de forma consistente;
  no hay un mecanismo único que la garantice para todos los recursos → auditar endpoint por endpoint
  (BOLA). Ver [[08-security/security-findings]] (SEC-6, INFERIDO) y [[08-security/abuse-cases]].
- Endpoints sin `@Roles` explícito quedan accesibles a cualquier usuario autenticado; verificar que
  las operaciones administrativas lleven el decorador.

Relacionado: [[08-security/threat-model]] · [[04-api/authentication]] · [[03-domains/auth/index]].
