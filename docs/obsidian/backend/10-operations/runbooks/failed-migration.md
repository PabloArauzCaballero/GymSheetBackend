---
type: runbook
status: verified
last_reviewed: 2026-08-06
source_revision: 27f3fd2
tags: [backend, operations, runbook, migration]
---

# Runbook — migración fallida

- **Síntoma:** el servicio `migrate` sale con código ≠ 0; la API y los workers **no arrancan**
  (dependencia `service_completed_successfully` no se cumple).
- **Impacto:** despliegue bloqueado. Por diseño, ninguna instancia sirve contra un esquema a medias.
- **Severidad:** crítica (bloquea el release; el sistema previo, si sigue arriba, no se ve afectado).

## Señales

- `docker compose ps migrate` → `exited (1)`.
- Logs de `migrate` con el error SQL/migración.
- `api`/workers en estado `created`/no iniciados (esperando a `migrate`).

## Diagnóstico

```bash
docker compose logs migrate
docker compose exec postgres psql -U "$DB_USER" -d "$DB_NAME" -c \
  "SELECT * FROM app_meta.schema_migrations ORDER BY 1;"
```

Determinar: ¿migración a medias?, ¿constraint/dato preexistente incompatible?, ¿permisos del rol de
migración?

## Mitigación

- **No** forzar el arranque de la API saltando el gate. El gate es la protección.
- Corregir la migración (forward-fix) es preferible a `migration:down` a ciegas.
- Si la migración quedó parcialmente aplicada y no es idempotente, evaluar restaurar desde backup
  antes de reintentar ([[../disaster-recovery]]).

## Recuperación

1. Confirmar compatibilidad hacia atrás con la versión previa de la app.
2. Si es seguro, desplegar la imagen anterior antes de revertir el esquema.
3. `yarn migration:down:prod` **solo** si no hay escrituras nuevas que dependan del esquema nuevo.
4. Verificar `app_meta.schema_migrations` y objetos removidos esperados.
5. Reintentar `migrate` con la corrección.

Detalle: `docs/operations/backup-restore-and-rollback.md` §Application and migration rollback.

## Validación

`migrate` sale 0; `api`/workers arrancan; `/health/ready` 200 (readiness incluye "migraciones
aplicadas"); smoke tests críticos verdes.

## Rollback

Ver [[../rollback]]. Nunca `migration:down` destructivo si borraría datos requeridos: restaurar
backup o forward-fix.

## Escalamiento

Migración irreversible o con riesgo de pérdida de datos → detenerse y escalar a DBA/Ingeniería
(regla de gobernanza: parar ante acciones irreversibles).

## Prevención

- Gate `migrate` one-shot antes de API (`restart: "no"`, ADR/compose) — ya implementado.
- CI ensaya migración up/down/reapply y preservación de datos
  (`docs/operations/backup-restore-and-rollback.md` §CI scope).
- Migraciones idempotentes y compatibles hacia atrás cuando sea posible.

## Referencias

[[../startup-shutdown]] · [[../rollback]] · [[../disaster-recovery]] · [[database-unavailable]]
