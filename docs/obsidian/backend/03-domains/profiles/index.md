---
title: "Profiles"
type: domain
status: verified
criticality: medium
last_reviewed: "2026-08-06"
source_revision: "27f3fd2"
domain: "profiles"
source_files: [
  "src/modules/profiles/profiles.controller.ts",
  "src/modules/profiles/profiles.service.ts",
  "src/modules/profiles/onboarding.controller.ts",
  "src/modules/profiles/onboarding.service.ts",
  "src/modules/profiles/onboarding.repository.ts",
  "src/modules/profiles/profiles.schemas.ts"
]
tags: [backend, domain]
related: ["[[03-domains/users/index]]", "[[03-domains/training/index]]"]
---

# Profiles

## Resumen

Onboarding por pasos, medidas corporales y proyección antropométrica del usuario. Dos submódulos:
`profiles` (perfil antropométrico upsert) y `onboarding` (flujo por pasos con proyección final).

## Responsabilidad

- Guardar/leer el perfil antropométrico del usuario.
- Conducir el onboarding (goals, profile, preferences, equipment) y finalizarlo (`complete`).
- Registrar medidas corporales idempotentes.

## Límites

- No calcula rutinas ni progreso; solo captura datos del usuario.

## Entradas

HTTP `/profile` y `/me/onboarding|body-measurements` (protegido), Zod
(`profiles.schemas.ts`, `onboarding.schemas.ts`).

## Salidas

DTOs vía `profile.mapper.ts`; proyección a `AnthropometricProfileModel` al completar.

## Casos de uso

Usuario: upsert de perfil; recorrer y completar onboarding; listar/añadir medidas.

## Reglas de negocio

- `complete`: transacción + `findForUpdate` (row lock), valida campos requeridos
  (`missingFields` → 422), convierte unidades y proyecta el perfil antropométrico.
- Medidas idempotentes por `idempotencyKey` (dedup silencioso).
- `savePreferences`: `consentHealth` y `consentData` requeridos; quiet-hours ambos-o-ninguno.

## Componentes principales

| Componente | Tipo | Responsabilidad | Evidencia |
|---|---|---|---|
| `ProfilesService` | Service | `getMyProfile`, `upsertMyProfile` | `profiles.service.ts` |
| `OnboardingService` | Service | Pasos, `complete`, medidas | `onboarding.service.ts` |
| `OnboardingRepository` | Repository | `findForUpdate`, `upsertProjection` | `onboarding.repository.ts` |

## Entidades y datos

`AnthropometricProfileModel` (`perfiles_antropometricos`; `userId` único, age, weightKg, heightCm,
goal), `BodyMeasurementModel` (`profile.body_measurements`; weight, unit, measuredOn, source,
idempotencyKey), `OnboardingModel` (`profile.onboarding`; PK `userId`, status, currentStep,
`completedSteps` JSONB, consentimientos, unidades). Detalle: [[05-data/index]].

## Endpoints o contratos

- Perfil: `GET /profile`, `POST /profile`, `PATCH /profile`.
- Onboarding: `GET /me/onboarding`, `PUT /me/onboarding/{profile,goals,preferences,equipment}`,
  `POST /me/onboarding/complete`, `GET|POST /me/body-measurements`.
- [[04-api/index]].

## Eventos

Ninguno.

## Dependencias

`SequelizeModule.forFeature([AnthropometricProfile, Onboarding, BodyMeasurement])`; `OnboardingService`
inyecta `Sequelize`. FK a `UserModel`.

## Autenticación y permisos

Ownership por `@CurrentUser().id`, nunca id del cliente. `getMyProfile` sin perfil → 404.

## Manejo de errores

`NotFoundException` (perfil ausente), `ConflictException` (no se pudo bloquear la fila de onboarding),
`UnprocessableEntityException` con `missingFields[]` al completar con datos pendientes.

## Transacciones y consistencia

Solo `saveProfile` y `complete` usan transacción + lock. `RIESGO`: `advance`/`saveGoals`/
`savePreferences`/`saveEquipment` actualizan `completedSteps` (read-modify-write sobre JSONB) sin
transacción ni lock → posible lost-update concurrente. `version` existe pero no se usa como
optimistic-lock.

## Procesamiento asíncrono

Ninguno.

## Observabilidad

`INFERIDO`: sin métricas específicas.

## Pruebas

- `profiles.service.spec.ts` — aislamiento horizontal (lookup/upsert scopeado al token).
- `onboarding.schemas.spec.ts` — FitnessGoal, consentimientos requeridos, validación de medida. Solo 3
  de 5 schemas ejercitados.

## Riesgos

- `PATCH /profile` no es parcial (comparte handler con `POST`, requiere body completo): confusión de
  contrato (`INFERIDO`).
- Lost-update en pasos de onboarding sin lock; `version` no aplicado.
- `mapState.missingFields` usa `completedSteps.includes(2)` como proxy de peso presente, puede diverger
  del chequeo real de `complete`.

## Referencias al código

- `onboarding.service.ts` → `complete`, `saveProfile`, `advance`, `missingFields`.
- `onboarding.repository.ts` → `findForUpdate`, `upsertProjection`.
- `profiles.schemas.ts` → `upsertProfileSchema`; `onboarding.schemas.ts` →
  `onboardingProfileSchema`, `onboardingPreferencesSchema`, `bodyMeasurementSchema`.

## Relaciones

[[03-domains/users/index]] · [[03-domains/training/index]] · [[03-domains/export/index]]
