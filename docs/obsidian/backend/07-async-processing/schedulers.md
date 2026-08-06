---
type: async-processing
status: verified
last_reviewed: 2026-08-06
source_revision: 27f3fd2
tags: [backend, async, scheduler]
---

# Schedulers (barridos programados)

No se usa `@nestjs/schedule` ni cron interno de la app. Los dos trabajos periódicos son **bucles de
polling con espera fija** dentro de sus runners, cancelables por `AbortSignal`.

## 1. Barrido de recordatorios de membresía

- Runner: `MembershipReminderRunner` (`membership-reminder.runner.ts`).
- Cadencia: `sleep(REMINDER_SCAN_INTERVAL_MS)` entre ciclos. Default **3.600.000 ms (1 h)**;
  rango permitido 60.000 ms – 86.400.000 ms (`src/config/env.ts`).
- Trabajo por ciclo: `MembershipReminderService.scan(WORKER_BATCH_SIZE * 10)` (default 500
  candidatos). Busca membresías por vencer (`findExpiringMemberships(today, limit)`), crea la
  notificación `PENDING` y encola su entrega a `notifications.delivery` respetando **quiet hours**
  (`NotificationScheduleService.nextAllowedAt` fija `available_at`).
- Zona horaria de negocio: `BUSINESS_TIME_ZONE` (default `America/La_Paz`).
- Errores: `membership_reminder.scan_failed` (no aborta el bucle; reintenta al siguiente ciclo).
- Es un **productor/scheduler**, no consume cola. Ver [[queues]] y [[../06-integrations/index]].

## 2. Refresco del dataset de ejercicios

- Runner: `ExercisesDatasetRefreshRunner` (`exercises-dataset-refresh.runner.ts`).
- Gating: si `EXERCISES_DATASET_ENABLED=false`, loguea `refresh_disabled` y solo duerme.
- Cadencia auto-ajustada: calcula `millisecondsUntilDatasetRefresh(latestImportedAt, now,
  EXERCISES_DATASET_REFRESH_INTERVAL_MS)`. Default intervalo **86.400.000 ms (24 h)**; si falta
  tiempo, duerme la diferencia (`refresh_scheduled`) en vez de refrescar.
- En fallo: `refresh_failed` y `sleep(EXERCISES_DATASET_REFRESH_RETRY_MS)` (default 1 h); el caché
  PostgreSQL previo permanece disponible. Ver [[batch-jobs]].

## Comando one-shot relacionado (no scheduler)

`db:outbox:prune` (`outbox-prune.command.ts`) es un comando **de disparo externo** (host cron /
Kubernetes CronJob), no un worker siempre activo. Ver [[batch-jobs]].
