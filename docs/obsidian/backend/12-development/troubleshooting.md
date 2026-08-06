---
title: "Troubleshooting (desarrollo)"
type: reference
status: verified
last_reviewed: "2026-08-06"
tags: [backend, development]
---

# Troubleshooting

| Síntoma | Causa probable | Acción |
|---|---|---|
| `/health/ready` → 503 | Esquema desactualizado o Redis configurado caído | `yarn migration:up`; verificar Redis / `REDIS_REQUIRED` |
| Arranque falla por env | `JWT_*_SECRET` ausentes/cortos (<64) o iguales | Completar `.env` (ver [[15-reference/environment-variables]]) |
| E2E falla al conectar | Falta PostgreSQL en `:5433` | Levantar DB de pruebas |
| Worker sin logs | (histórico F-015) `flushLogs()` | Confirmar bootstrap; ver [[07-async-processing/workers]] |
| 500 al crear con dato duplicado | UniqueConstraint no traducido (DATA-05) | Ver [[14-audits/risks-register]] |

Runbooks de producción: [[10-operations/runbooks/index]].
