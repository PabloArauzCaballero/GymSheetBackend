---
title: "Matriz de comunicación"
type: architecture
status: verified
last_reviewed: "2026-08-06"
source_revision: "27f3fd2"
tags: [backend, architecture]
---

# Matriz de comunicación

Canales entre componentes y sistemas externos. Timeouts desde `src/config/env.ts` (defaults).

| Origen | Destino | Protocolo | Auth | Sync | Timeout |
|---|---|---|---|---|---|
| Frontend / cliente | API | HTTPS/JSON | JWT HS256 (Bearer) | Sync | body/handler |
| Adapter PACS | API (evento) | HTTPS/JSON canónico | credencial adapter (INFERIDO) | Sync (encola) | — |
| Scraper | API `/health/metrics` | HTTP | `METRICS_SCRAPE_TOKEN` | Sync | — |
| API | PostgreSQL | TCP (Sequelize) | usuario/clave DB | Sync | `DB_STATEMENT_TIMEOUT_MS` 15000; connect 10000 |
| API | Redis | TCP | (opcional) | Sync | `REDIS_CONNECT_TIMEOUT_MS` 5000 |
| worker-access | PostgreSQL | TCP claim SKIP LOCKED | usuario/clave DB | Async (polling) | lease `WORKER_LOCK_TIMEOUT_MS` 300000 |
| worker-reminders | PostgreSQL | TCP scan + outbox | usuario/clave DB | Async | `REMINDER_SCAN_INTERVAL_MS` 3600000 |
| worker-notifications | PostgreSQL | TCP claim outbox | usuario/clave DB | Async | poll 1000 |
| worker-notifications | Gateway externo | HTTPS firmado | secreto de firma | Sync saliente | `NOTIFICATION_GATEWAY_TIMEOUT_MS` 10000 |
| worker-exercises-dataset | Dataset externo | HTTPS | allowlist (sin auth) | Sync saliente | `EXERCISES_DATASET_TIMEOUT_MS` 15000 |

## Notas

- **Sync interno API↔DB↔Redis**: request-response en la misma petición.
- **Async por outbox**: la API no llama directamente a los workers; deja trabajo en
  `integration.outbox_jobs` / `access_control.device_events` y el worker lo reclama por polling
  (entrega at-least-once). Ver [[02-architecture/data-flow]].
- **Rate limiting**: `RATE_LIMIT_MAX` 100/60s general; `AUTH_RATE_LIMIT_MAX` 10 en `/auth/*`.
- La auth exacta del adapter PACS está **INFERIDA**: ADR-0002 exige canal autenticado (preferente
  OSDP Secure Channel) pero el fabricante no está confirmado.
