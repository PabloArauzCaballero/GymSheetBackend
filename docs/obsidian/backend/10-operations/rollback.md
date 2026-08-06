---
type: operations
status: verified
last_reviewed: 2026-08-06
source_revision: 27f3fd2
tags: [backend, operations, rollback]
---

# Rollback

Procedimiento completo ya existente (reutilizar, no duplicar):
`docs/operations/backup-restore-and-rollback.md`. Aquí solo el resumen y los enganches.

## Rollback de aplicación + migración

1. Detener el tráfico de despliegue nuevo.
2. Confirmar si la migración es **compatible hacia atrás** con la versión anterior de la app.
3. Si es seguro, desplegar la imagen anterior **antes** de revertir la migración.
4. `yarn migration:down:prod`.
5. Verificar metadata de migración (`app_meta.schema_migrations`) y objetos removidos esperados.
6. Correr readiness + smoke tests críticos.
7. Restaurar tráfico gradualmente.

> **No** correr `migration:down` a ciegas si escrituras nuevas dependen del esquema nuevo. Si el
> rollback destruiría datos requeridos, **restaurar desde backup** o aplicar una migración
> forward-fix. Ver [[disaster-recovery]].

## Interacción con los workers

- Al desplegar, los workers reciben `SIGTERM` → `worker.shutdown_requested` → drenan el job en curso
  dentro de `stop_grace_period: 45s`. Ningún job en vuelo se pierde: un lease huérfano se reclama tras
  `WORKER_LOCK_TIMEOUT_MS`. Ver [[startup-shutdown]] y
  [[../07-async-processing/ordering-and-concurrency]].
- La cola outbox es durable en PostgreSQL: un rollback de app no pierde trabajo encolado.

## Registro de evidencia

Para cada ensayo o incidente, registrar timestamp, operador, commit SHA, versión de PostgreSQL,
tamaño/checksum del backup, duraciones y resultado de smoke tests (ver el doc fuente §Evidence
record). No declarar éxito sin evidencia ejecutada.

## Wikilinks

[[disaster-recovery]] · [[deployment]] · [[startup-shutdown]] · [[health-checks]]
