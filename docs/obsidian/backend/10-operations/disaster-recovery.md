---
type: operations
status: verified
last_reviewed: 2026-08-06
source_revision: 27f3fd2
tags: [backend, operations, disaster-recovery, backup]
---

# Recuperación ante desastres (backup / restore)

Procedimiento completo y ensayo en CI: `docs/operations/backup-restore-and-rollback.md`. Aquí el
resumen operativo.

## Objetivo

Probar que un release se puede **recuperar**, no solo que el comando de backup termina. El workflow de
CI ensaya `pg_dump`/`pg_restore` desechable y verifica la migración de endurecimiento en ambos
sentidos.

## Backup

Formato custom para fallar rápido y preservar metadata:

```bash
pg_dump --host "$DB_HOST" --port "$DB_PORT" --username "$BACKUP_DB_USER" \
        --dbname "$DB_NAME" --format custom --file "gym-sheet-<UTC>.dump"
```

Guardar cifrado y con control de acceso; registrar checksum SHA-256. Nunca poner credenciales en la
línea de comandos.

## Restore rehearsal

Restaurar en una base **desechable y aislada** (`pg_restore --exit-on-error`). Verificar al menos:
esquemas/tablas esperados, `app_meta.schema_migrations` acorde al release, conteos y relaciones,
constraints e índices críticos, readiness contra la base restaurada, y un login + una lectura de
workout propia con datos sintéticos.

## Alcance de datos

- **PostgreSQL** es la única fuente de verdad, incluida la cola outbox (durable) y el historial de
  eventos de dominio. El backup de Postgres cubre el trabajo asíncrono en vuelo.
- **Redis** es efímero (solo contadores de rate limit): **no** requiere backup; se reconstruye solo.
- El caché del dataset de ejercicios vive en Postgres (se recupera con el dump) y además es
  re-derivable re-ejecutando el import ([[../06-integrations/exercises-dataset/overview]]).

## Registro de evidencia

Timestamp, operador, commit SHA, versión de PostgreSQL, tamaño/checksum del backup, duraciones de
backup/restore/migración, resultados de verificación y smoke test, desviaciones. El ensayo de CI no
sustituye uno con volumen y permisos production-like.

## Wikilinks

[[rollback]] · [[deployment]] · [[runbooks/database-unavailable]] · [[runbooks/failed-migration]]
