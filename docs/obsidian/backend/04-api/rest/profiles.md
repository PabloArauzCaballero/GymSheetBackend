---
title: "REST · Profiles y Onboarding"
type: api
status: verified
last_reviewed: "2026-08-06"
source_revision: "27f3fd2"
tags: [backend, api]
---

# REST · Profiles y Onboarding

Controladores: `src/modules/profiles/profiles.controller.ts`
(`@Controller('profile')`) y `onboarding.controller.ts` (`@Controller('me')`) ·
Servicios: `profiles.service.ts`, `onboarding.service.ts` · Esquemas:
`profiles.schemas.ts`, `onboarding.schemas.ts`. Mapper: `profile.mapper.ts` (nunca
ORM directo). Todo es **propiedad por usuario**.

## Perfil antropométrico — `profiles.controller.ts`

| Método | Ruta | Body | Errores | Propósito |
|---|---|---|---|---|
| GET | `/profile` | — | 404 | Perfil propio |
| POST | `/profile` | `upsertProfileSchema` | 400 | Crear o reemplazar (upsert) |
| PATCH | `/profile` | `upsertProfileSchema` | 400 | Actualizar (mismo upsert) |

`ProfileRequest`: `edad` 12–100, `pesoKg` 1–400, `estaturaCm` 80–250, `objetivo`
(`HIPERTROFIA`/`FUERZA`/`RESISTENCIA`/`PERDIDA_GRASA`/`SALUD_GENERAL`/`REHABILITACION`).
Unidades canónicas: kg, cm, timestamps explícitos.

## Onboarding y mediciones — `onboarding.controller.ts`

| Método | Ruta | Body | Errores | Propósito |
|---|---|---|---|---|
| GET | `/me/onboarding` | — | — | Estado y campos pendientes |
| PUT | `/me/onboarding/profile` | `onboardingProfileSchema` | 400 | Medidas, unidades, fecha |
| PUT | `/me/onboarding/goals` | `onboardingGoalsSchema` | — | Objetivo principal |
| PUT | `/me/onboarding/preferences` | `onboardingPreferencesSchema` | — | Preferencias y consentimientos |
| PUT | `/me/onboarding/equipment` | `onboardingEquipmentSchema` | — | Equipamiento disponible |
| POST | `/me/onboarding/complete` | — | 422 | Completa idempotentemente; 422 si faltan obligatorios |
| GET | `/me/body-measurements` | — | — | Historial corporal ordenado por fecha |
| POST | `/me/body-measurements` | `bodyMeasurementSchema` | 201 | Añade medición sin sobrescribir |

Estados: `OnboardingStatus`
(`NOT_STARTED`/`IN_PROGRESS`/`COMPLETED`/`REQUIRES_UPDATE`).

Relacionado: [[04-api/conventions]] · [[users]] · [[03-domains/profiles/index]]
