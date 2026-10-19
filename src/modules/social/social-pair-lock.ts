import { QueryTypes, Transaction } from "sequelize";
import { Sequelize } from "sequelize-typescript";

/** Serialize operations for a user pair using the same stable lock order. */
export async function lockSocialPairUsers(
  sequelize: Sequelize,
  userA: string,
  userB: string,
  transaction: Transaction,
): Promise<void> {
  await sequelize.query(
    `SELECT id FROM public.usuarios WHERE id IN (:userA, :userB) ORDER BY id FOR UPDATE`,
    { type: QueryTypes.SELECT, replacements: { userA, userB }, transaction },
  );
}
