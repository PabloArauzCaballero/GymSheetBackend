---
title: "Runbook — Rotación de secretos"
type: runbook
status: verified
criticality: high
last_reviewed: "2026-08-06"
source_revision: "27f3fd2"
tags: [backend, operations, runbook, security]
related: ["[[08-security/secrets-management]]"]
---

# Runbook — Rotación de secretos

## Síntoma / disparador
Sospecha de fuga, salida de personal, o rotación programada de `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `DB_PASSWORD`, `NOTIFICATION_GATEWAY_SECRET`, `METRICS_SCRAPE_TOKEN` o `SEED_*_PASSWORD`.

## Impacto
Rotar `JWT_ACCESS_SECRET` **invalida todos los access tokens** vigentes (los usuarios deben reautenticarse). No hay refresh token implementado (ver [[14-audits/risks-register]] SEC-02), por lo que la reautenticación es login completo.

## Severidad
Alta (autenticación) / Media (gateway, métricas).

## Prerrequisitos
Acceso al gestor de secretos/entorno de despliegue. Ventana de mantenimiento si se rota JWT.

## Procedimiento
1. Generar el nuevo secreto (≥64 chars para JWT; distinto de los demás — validado al arranque).
2. Actualizar la variable en el entorno/secret manager (NUNCA en el repo ni en logs).
3. `DB_PASSWORD`: cambiar en PostgreSQL y en la variable de forma coordinada.
4. Redeploy de `api` y de los 4 workers para recoger el nuevo valor.
5. `METRICS_SCRAPE_TOKEN`: actualizar también en el scraper de Prometheus.

## Validación posterior
- `GET /health/ready` → 200.
- Login emite token válido; peticiones autenticadas funcionan.
- Scrape de `/health/metrics` con el nuevo token → 200; con el viejo → 401/403.

## Rollback
Restaurar el valor anterior en la variable y redeploy (si el nuevo secreto causa fallo de arranque por validación).

## Escalamiento / prevención
- Documentar la rotación en el registro de cambios.
- Considerar refresh token + revocación para evitar invalidar todas las sesiones (SEC-02).

## Referencias
[[08-security/secrets-management]] · [[15-reference/environment-variables]] · [[10-operations/runbooks/index]].
