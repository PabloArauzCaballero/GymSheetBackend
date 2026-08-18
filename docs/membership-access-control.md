# Membresías y control de acceso

Rol, membresía y derecho son conceptos separados. `membership.features` define capacidades, `plan_features` las asigna a planes y `entitlements` registra concesiones por `MEMBERSHIP`, `PURCHASE`, `ADMIN_GRANT`, `PROMOTION` o `TRIAL`.

`GET /me/accesses` combina features del plan vigente con concesiones explícitas activas y elimina duplicados por código. Nunca concede derechos por un rol “premium”. El motor físico existente continúa revalidando estado, fechas y alcance.
