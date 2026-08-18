# ADR-0008 — Intake de una reforma de esquema de base de datos

Estado: **cerrado — no aplica** (decisión del propietario, 2026-08-12: "no hay reforma de esquema")  
Fecha: 2026-08-07 · **Cerrado:** 2026-08-12  
Origen: skill externa `github-canonical-data-reform`, fases 4–5.

## Resolución (2026-08-12)

El propietario confirmó que **no hay reforma de esquema**: el esquema actual se conserva tal cual.
En consecuencia las fases 4–6, 14 y 17 de la skill quedan **No aplicables** (no bloqueadas, no
pendientes). Este ADR se conserva como registro. Si en el futuro surge una reforma, reabrir con la
matriz de intake descrita abajo.

## Contexto

La skill es una **reforma de esquema**: su fase 4 exige "el usuario entregará o habrá entregado la
reforma deseada" que define el *target schema* (entidades, campos, relaciones, constraints, tipos,
nulabilidad, índices). Ese documento **no existe** en el repositorio ni fue entregado.

Reglas aplicables (precedencia, `CLAUDE.md`):
- Regla [00-governance](../../.claude/rules/00-governance.md): "No inventes archivos, comandos,
  librerías... Si algo falta, decláralo faltante"; "Detente antes de acciones irreversibles:
  migraciones destructivas".
- La propia skill (§10.2): prohíbe inventar IDs, relaciones, montos, estados; y (§10.4): "Si un campo
  obligatorio no puede resolverse con evidencia, la reforma debe detenerse antes de corromper el
  dataset".

Fabricar una reforma de esquema sin especificación equivaldría a inventar requisitos y a arriesgar
migraciones destructivas contra un repo orientado a producción — exactamente lo que ambas fuentes
prohíben, y análogo al precedente de alcance de
[`BACKEND_AUDIT_HARDENING_AND_ACTION_PLAN.md` §0](../../BACKEND_AUDIT_HARDENING_AND_ACTION_PLAN.md).

## Decisión

**No se diseña ni aplica ninguna migración de reforma** hasta recibir la especificación. La fase 4 (y
en cascada 5, 6, 14, 17) queda **BLOCKED** y documentada, no fabricada.

## Cómo desbloquear (formato de intake requerido)

Entregar, por entidad afectada, una matriz de cambio (formato de la skill §8.1):

| Origen (tabla.campo) | Destino | Tipo de cambio | Regla de transformación | Reversible |
|---|---|---|---|---|

Tipos de cambio a declarar: rename/add/remove/split/merge/type/nullability/default/enum↔catalog/FK/
cardinalidad/normalización/índice/unique/check/soft-delete/ownership. Preferir estrategia
**expand→backfill→contract** para cambios riesgosos.

Con esa matriz, el mecanismo de migraciones existente (una transacción por migración, `down`, registry
ordenado, readiness que verifica pendientes) permite implementarla de forma segura y reversible.

## Consecuencias

- (+) Se protege la integridad de los datos y se respeta la gobernanza.
- (−) La "reforma de esquema" prometida por la skill no se materializa en esta corrida; queda como
  trabajo desbloqueado por un input del propietario.
