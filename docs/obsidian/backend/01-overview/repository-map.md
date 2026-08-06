---
title: "Mapa del repositorio"
type: overview
status: verified
criticality: medium
last_reviewed: "2026-08-06"
source_revision: "27f3fd2"
tags: [backend, overview, repo-map]
---

# Mapa del repositorio

```text
src/
├── main.ts                 # bootstrap API
├── app.module.ts           # wiring raíz
├── common/                 # middlewares, filtros, guards, utilidades transversales
├── config/                 # configuración por entorno (Zod env)
├── database/               # bootstrap Sequelize, migraciones, registries
│   └── migrations/         # 10 migraciones de negocio + helpers
├── gateway/                # gateway opcional (GATEWAY_ENABLED)
├── workers/                # 4 workers de background + loop/bootstrap
└── modules/                # 15 módulos de dominio
    ├── access-control/     # credenciales, dispositivos, decisiones de acceso
    ├── auth/               # login, refresh, JWT
    ├── equipment/          # equipamiento
    ├── exercises/          # catálogo + media + sync dataset
    ├── export/             # exportación de datos
    ├── facilities/         # sucursales, salas, puntos de acceso, mantenimiento
    ├── health/             # liveness/readiness/metrics
    ├── integration/        # outbox transaccional, domain events, legacy import
    ├── membership/         # planes, membresías, entitlements, staff (18 modelos)
    ├── notifications/      # preferencias, entrega, recordatorios
    ├── profiles/           # onboarding, antropometría, medidas
    ├── training/           # rutinas y asignaciones
    ├── users/              # usuarios
    └── workouts/           # sesiones y sets de entrenamiento

docs/                       # documentación previa (arquitectura, db, endpoints, ADRs, ops)
test/                       # pruebas (unit + e2e + load)
```

## Métricas (revisión `27f3fd2`)

- 245 archivos `.ts` en `src/` · 19 controllers · 27 services · 44 models · 10 migraciones de negocio · 113 rutas HTTP.

Ver [[03-domains/index]] para el detalle por módulo.
