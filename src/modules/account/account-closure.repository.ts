import { Injectable } from "@nestjs/common";
import { QueryTypes, Transaction } from "sequelize";
import { Sequelize } from "sequelize-typescript";
import { ACCOUNT_CLOSURE_STEPS } from "./account-closure.catalog";
import { ClosureStep, mediaKeysOf } from "./account-closure.steps";

export type ClosureStepCount = { step: ClosureStep; count: number };

export type ClosedAccountValues = { tombstoneEmail: string; unusablePasswordHash: string };

/** Data access of the account closure; every statement comes from the catalogue. */
@Injectable()
export class AccountClosureRepository {
  constructor(private readonly sequelize: Sequelize) {}

  runInTransaction<T>(work: (transaction: Transaction) => Promise<T>): Promise<T> {
    return this.sequelize.transaction(work);
  }

  async hasLinkedIdentity(userId: string, transaction?: Transaction): Promise<boolean> {
    const [row] = await this.sequelize.query<{ linked: boolean }>(
      `SELECT EXISTS (SELECT 1 FROM auth.identities WHERE user_id = :userId) AS linked`,
      { type: QueryTypes.SELECT, replacements: { userId }, transaction },
    );
    return row?.linked === true;
  }

  /**
   * Locks every active ADMIN of a gym, in id order (two admins closing each
   * other cannot deadlock), and returns their ids: the caller refuses to
   * close the last one, and no concurrent closure can slip past that count.
   */
  async lockActiveAdmins(tenantId: string, defaultTenantId: string, transaction: Transaction): Promise<string[]> {
    const rows = await this.sequelize.query<{ id: string }>(
      `SELECT id FROM public.usuarios
        WHERE rol = 'ADMIN' AND estado = 'ACTIVO' AND COALESCE(tenant_id, :defaultTenantId) = :tenantId
        ORDER BY id FOR UPDATE`,
      { type: QueryTypes.SELECT, replacements: { tenantId, defaultTenantId }, transaction },
    );
    return rows.map((row) => row.id);
  }

  /** One round trip: a count per visible step, evaluated on the current state. */
  async countSteps(userId: string): Promise<ClosureStepCount[]> {
    const visible = ACCOUNT_CLOSURE_STEPS.filter((step) => !step.internal);
    const sql = visible
      .map((step, index) => `SELECT ${index} AS idx, count(*)::int AS count FROM ${step.table} t WHERE ${step.where}`)
      .join("\nUNION ALL\n");
    const rows = await this.sequelize.query<{ idx: number; count: number }>(sql, {
      type: QueryTypes.SELECT,
      replacements: { userId },
    });
    const counts = new Map(rows.map((row) => [Number(row.idx), Number(row.count)]));
    return visible.map((step, index) => ({ step, count: counts.get(index) ?? 0 }));
  }

  /** Storage keys of every row the closure removes, read before anything changes. */
  async collectMediaKeys(userId: string, transaction: Transaction): Promise<string[]> {
    const withMedia = ACCOUNT_CLOSURE_STEPS.filter((step) => step.mediaKey && step.disposition !== "KEPT");
    if (withMedia.length === 0) return [];
    const sql = withMedia
      .flatMap((step) => mediaKeysOf(step.mediaKey).map((key) => `SELECT ${key} AS key FROM ${step.table} t WHERE ${step.where}`))
      .join("\nUNION\n");
    const rows = await this.sequelize.query<{ key: string | null }>(sql, {
      type: QueryTypes.SELECT,
      replacements: { userId },
      transaction,
    });
    return [...new Set(rows.map((row) => row.key).filter((key): key is string => Boolean(key)))];
  }

  /** Runs the catalogue in order, inside the closure transaction. */
  async eraseAll(userId: string, transaction: Transaction): Promise<void> {
    for (const step of ACCOUNT_CLOSURE_STEPS) {
      if (step.disposition === "KEPT") continue;
      const sql = step.disposition === "DELETED"
        ? `DELETE FROM ${step.table} t WHERE ${step.where}`
        : `UPDATE ${step.table} t SET ${step.set} WHERE ${step.where}`;
      await this.sequelize.query(sql, { replacements: { userId }, transaction });
    }
  }

  /**
   * The account row stays (its id anchors the gym's records) but carries no
   * personal data. The email becomes a unique tombstone, so the address can
   * sign up again; the password hash is of random bytes nobody knows.
   */
  async anonymizeAccount(userId: string, values: ClosedAccountValues, transaction: Transaction): Promise<Date> {
    const [row] = await this.sequelize.query<{ closedAt: Date }>(
      `UPDATE public.usuarios
          SET email = :tombstoneEmail, password_hash = :unusablePasswordHash,
              nombre_completo = 'Cuenta cerrada', genero = NULL, fecha_nacimiento = NULL,
              estado = 'INACTIVO', closed_at = now(), sede_id = NULL, last_seen_at = NULL,
              email_verified_at = NULL, signup_risk = NULL, suspended_until = NULL, updated_at = now()
        WHERE id = :userId
      RETURNING closed_at AS "closedAt"`,
      { type: QueryTypes.SELECT, replacements: { userId, ...values }, transaction },
    );
    if (!row) throw new Error("Account row disappeared during closure.");
    return row.closedAt;
  }

  /**
   * Keys still used by a row the closure kept (reported reels, the evidence
   * copy of a reported chat message, or a shared file). The media worker
   * re-checks every reference itself (`MediaReferencesRepository`); filtering
   * here as well keeps jobs that would only end as "file kept" out of the queue.
   * Evidence is checked on both sides: a release must never destroy it.
   */
  async keysStillInUse(keys: string[], transaction: Transaction): Promise<Set<string>> {
    if (keys.length === 0) return new Set();
    const rows = await this.sequelize.query<{ key: string }>(
      `SELECT k.key FROM unnest(ARRAY[:keys]::text[]) AS k(key)
        WHERE EXISTS (SELECT 1 FROM social.reels r WHERE r.storage_key = k.key)
           OR EXISTS (SELECT 1 FROM moderation.chat_message_evidence e WHERE e.media_key = k.key)
           OR EXISTS (SELECT 1 FROM community.content_comments c
                       WHERE c.adjunto_url IS NOT NULL AND right(c.adjunto_url, length(k.key) + 1) = '/' || k.key)`,
      { type: QueryTypes.SELECT, replacements: { keys }, transaction },
    );
    return new Set(rows.map((row) => row.key));
  }
}
