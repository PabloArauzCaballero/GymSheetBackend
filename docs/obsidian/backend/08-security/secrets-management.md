---
title: "Gestión de secretos"
type: security
status: verified
criticality: high
last_reviewed: "2026-08-06"
source_revision: "27f3fd2"
source_files:
  - "src/config/env.ts"
  - ".env.example"
tags: [backend, security, secrets, config]
---

# Gestión de secretos

> Defensivo. **Nunca** se documentan valores reales de secretos.

## Principios (VERIFICADO)

- **Solo por variables de entorno.** No hay secretos en el repositorio. Solo `.env.example` se
  versiona (`.env` está ignorado por git).
- **Validación al arranque con Zod** (`env.ts`): el proceso **falla rápido** si un secreto no cumple
  su política. Longitudes mínimas forzadas:
  - `JWT_ACCESS_SECRET` ≥ 64 · `JWT_REFRESH_SECRET` ≥ 64, y **deben ser distintos** (`env.ts:302-307`).
  - `METRICS_SCRAPE_TOKEN`, `NOTIFICATION_GATEWAY_SECRET` ≥ 32 (opcionales; vacío = ausente).
  - `SEED_ADMIN_PASSWORD`, `SEED_MOCK_PASSWORD` ≥ 12.
- **No se registran valores.** `dotenv` se carga con `quiet: true` para no contaminar el stream de
  logs estructurado (`env.ts:5-6`); la política de logs prohíbe registrar secretos
  (ver [[09-observability/logging]]).
- **Guardas de producción**: el arranque rechaza combinaciones peligrosas —`ACCESS_MOCK_ENABLED` o
  `NOTIFICATION_DELIVERY_PROVIDER=MOCK` en producción, gateway sin HTTPS o fuera de allowlist
  (`env.ts:308-350`).

## Inventario de secretos (solo nombres)

| Secreto | Uso | Política |
|---|---|---|
| `JWT_ACCESS_SECRET` | Firma de access token HS256 | ≥ 64, ≠ refresh |
| `JWT_REFRESH_SECRET` | Firma de refresh token | ≥ 64, ≠ access |
| `DB_PASSWORD` | Credencial PostgreSQL | ≥ 1 (proveer robusta) |
| `METRICS_SCRAPE_TOKEN` | Bearer de `/health/metrics` | ≥ 32 (opcional) |
| `NOTIFICATION_GATEWAY_SECRET` | Auth gateway de notificaciones | ≥ 32 (requerido si HTTP_GATEWAY) |
| `SEED_ADMIN_PASSWORD` | Contraseña de admin sembrado | ≥ 12 (opcional) |
| `SEED_MOCK_PASSWORD` | Contraseña de datos mock | ≥ 12 (opcional) |

La lista completa de variables (secretas y no secretas) con ejemplos seguros está en
[[15-reference/environment-variables]].

## Rotación

Procedimiento de rotación de secretos: `docs/security/secret-rotation-runbook.md` →
ver [[10-operations/secret-rotation-runbook]]. Rotar `JWT_ACCESS_SECRET` invalida todos los access
tokens vigentes (los clientes deben re-autenticarse).

## Brechas / advertencias

- `DB_PASSWORD` solo exige longitud ≥ 1; la robustez depende del operador.
- No hay integración con un gestor de secretos (Vault/KMS) en el código revisado; la protección
  depende del entorno de despliegue (INFERIDO).

Relacionado: [[08-security/data-protection]] · [[08-security/security-overview]].
