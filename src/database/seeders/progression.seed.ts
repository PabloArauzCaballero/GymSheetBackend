import { Transaction } from "sequelize";
import { ProgressionBadgeModel } from "../../modules/progression/progression-badge.model";
import {
  badgeSeeds,
  levelSeeds,
} from "../../modules/progression/progression-catalog";
import { ProgressionLevelModel } from "../../modules/progression/progression-level.model";

/**
 * Siembra el catálogo global de la senda.
 *
 * Es catálogo de producto, no datos de prueba: se siembra también en `base`,
 * porque un gimnasio recién instalado tiene que abrir la pantalla y ver algo.
 *
 * La siembra es idempotente y **conservadora**: crea lo que falta y refresca los
 * textos, pero no toca `active`. Un gimnasio que retiró un rango no quiere que
 * el siguiente despliegue se lo devuelva.
 *
 * Solo alcanza a las filas globales (`tenant_id IS NULL`). Lo que un gimnasio
 * haya creado para sí mismo es suyo y esta función no lo conoce.
 *
 * Se resuelve leyendo primero y escribiendo después, en vez de con un `upsert`:
 * la unicidad la garantiza un índice **por expresión** —normaliza el nulo de
 * `tenant_id` con COALESCE— y `ON CONFLICT` por columnas no reconoce ese índice.
 * El catálogo son decenas de filas; la lectura previa no cuesta nada.
 */
export async function seedProgression(transaction: Transaction): Promise<{
  levelsCreated: number;
  levelsUpdated: number;
  badgesCreated: number;
  badgesUpdated: number;
}> {
  const counters = {
    levelsCreated: 0,
    levelsUpdated: 0,
    badgesCreated: 0,
    badgesUpdated: 0,
  };

  const existingLevels = await ProgressionLevelModel.findAll({
    where: { tenantId: null },
    transaction,
  });
  const levelByKey = new Map(
    existingLevels.map((level) => [`${level.audience}:${level.code}`, level]),
  );

  for (const seed of levelSeeds) {
    const editable = {
      name: seed.name,
      tagline: seed.tagline,
      description: seed.description,
      minPoints: seed.minPoints,
      sortOrder: seed.sortOrder,
      icon: seed.icon,
      color: seed.color,
    };
    const existing = levelByKey.get(`${seed.audience}:${seed.code}`);
    if (existing) {
      await existing.update(editable, { transaction });
      counters.levelsUpdated += 1;
      continue;
    }
    await ProgressionLevelModel.create(
      { tenantId: null, audience: seed.audience, code: seed.code, ...editable } as never,
      { transaction },
    );
    counters.levelsCreated += 1;
  }

  const existingBadges = await ProgressionBadgeModel.findAll({
    where: { tenantId: null },
    transaction,
  });
  const badgeByKey = new Map(
    existingBadges.map((badge) => [`${badge.audience}:${badge.code}`, badge]),
  );

  for (const seed of badgeSeeds) {
    const editable = {
      name: seed.name,
      description: seed.description,
      flavorText: seed.flavorText,
      category: seed.category,
      rarity: seed.rarity,
      icon: seed.icon,
      color: seed.color,
      criterionType: seed.criterionType,
      criterionThreshold: seed.criterionThreshold.toFixed(2),
      pointsReward: seed.pointsReward,
      secret: seed.secret,
      sortOrder: seed.sortOrder,
    };
    const existing = badgeByKey.get(`${seed.audience}:${seed.code}`);
    if (existing) {
      await existing.update(editable, { transaction });
      counters.badgesUpdated += 1;
      continue;
    }
    await ProgressionBadgeModel.create(
      { tenantId: null, audience: seed.audience, code: seed.code, ...editable } as never,
      { transaction },
    );
    counters.badgesCreated += 1;
  }

  return counters;
}
