---
title: "REST · Users"
type: api
status: verified
last_reviewed: "2026-08-06"
source_revision: "27f3fd2"
tags: [backend, api]
---

# REST · Users

Controlador: `src/modules/users/users.controller.ts` (`@Controller('users')`) ·
Servicio: `users.service.ts` · Repositorio: `users.repository.ts` · Mapper:
`user.mapper.ts`. En OpenAPI.

| Método | Ruta | Auth | Body | Errores | Propósito |
|---|---|---|---|---|---|
| GET | `/users/me` | JWT | — | 401, 404 | Datos del usuario activo, mapeados |

Notas:

- `getActiveUserOrFail(user.id)` + `mapUserToResponse` → nunca se devuelve el modelo
  Sequelize (ver [[04-api/conventions]]).
- `UsersRepository` es también la fuente de la **revalidación del principal** en cada
  request (`findActiveById`) y del login anti-enumeración (`findActiveByEmail`) — ver
  [[04-api/authentication]].
- Roles del usuario: enum `UserRole` (ADMIN/CLIENTE/ENTRENADOR_EXTERNO/COACH/FRONT_DESK).

Relacionado: [[auth/index]] · [[profiles]] · [[03-domains/users/index]]
