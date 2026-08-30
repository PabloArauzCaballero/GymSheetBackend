import { DatabaseMigration } from "./migration.types";
import { executeSqlStatements } from "./sql-migration.helpers";

/**
 * Recompensas materiales por racha.
 *
 * Reutiliza el patrón de beneficios ya existente (`membership.entitlements`)
 * en vez de inventar uno nuevo: una recompensa de racha es, para el resto del
 * sistema, exactamente lo mismo que un cupón otorgado por el gimnasio — ya
 * aparece junto al resto de accesos en `GET .../accesses`. Solo hace falta
 * que el catálogo tenga las features y que `source_type` admita este origen.
 *
 * Los umbrales se pagan sobre `longestStreakDays`, no sobre la racha vigente:
 * mismo criterio que los puntos, para que una recompensa ya ganada no se
 * pueda perder por descansar.
 */
const upStatements = [
  `ALTER TABLE membership.entitlements DROP CONSTRAINT ck_entitlement_source`,
  `ALTER TABLE membership.entitlements
     ADD CONSTRAINT ck_entitlement_source
     CHECK (source_type IN ('MEMBERSHIP','PURCHASE','ADMIN_GRANT','PROMOTION','TRIAL','STREAK_REWARD'))`,
  `INSERT INTO membership.features (code, name, description)
   VALUES
     ('STREAK_REWARD_7', 'Racha de 7 días', 'Recompensa por entrenar siete días seguidos.'),
     ('STREAK_REWARD_30', 'Racha de 30 días', 'Recompensa por entrenar treinta días seguidos.'),
     ('STREAK_REWARD_90', 'Racha de 90 días', 'Recompensa por entrenar noventa días seguidos.')
   ON CONFLICT (code) DO NOTHING`,
] as const;

const downStatements = [
  `DELETE FROM membership.entitlements WHERE source_type = 'STREAK_REWARD'`,
  `DELETE FROM membership.features WHERE code IN ('STREAK_REWARD_7', 'STREAK_REWARD_30', 'STREAK_REWARD_90')`,
  `ALTER TABLE membership.entitlements DROP CONSTRAINT ck_entitlement_source`,
  `ALTER TABLE membership.entitlements
     ADD CONSTRAINT ck_entitlement_source
     CHECK (source_type IN ('MEMBERSHIP','PURCHASE','ADMIN_GRANT','PROMOTION','TRIAL'))`,
] as const;

export const streakRewardFeaturesMigration: DatabaseMigration = {
  id: "202608250005-streak-reward-features",
  description:
    "Seeds streak-reward catalogue features and allows STREAK_REWARD as an entitlement source.",
  up: (queryInterface, transaction) =>
    executeSqlStatements(queryInterface, transaction, upStatements),
  down: (queryInterface, transaction) =>
    executeSqlStatements(queryInterface, transaction, downStatements),
};
