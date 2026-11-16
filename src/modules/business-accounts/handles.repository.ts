import { Injectable } from '@nestjs/common';
import { QueryTypes, Transaction } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import { PENDING_HANDLE_TTL_DAYS, addDays } from './handle-rules';

export type HandleStatus = 'PENDING' | 'ACTIVE' | 'RETIRED' | 'RESERVED';

export type HandleRow = {
  handle: string;
  skeleton: string;
  ownerEntityId: string | null;
  status: HandleStatus;
  redirectToHandle: string | null;
  redirectUntil: Date | null;
  lockedUntil: Date | null;
  updatedAt: Date;
};

const COLUMNS = `h.handle, h.skeleton, h.owner_entity_id AS "ownerEntityId", h.status,
  h.redirect_to_handle AS "redirectToHandle", h.redirect_until AS "redirectUntil",
  h.locked_until AS "lockedUntil", h.updated_at AS "updatedAt"`;

/**
 * Rows that still hold a skeleton: live handles, REPP reservations, retired
 * handles inside their lock, and PENDING reservations that have not expired.
 * A PENDING reservation expires when its listing is still DRAFT the TTL after
 * the listing was created: a fixed start that no write to the handle moves.
 */
const HOLDS_SKELETON = `(
  h.status IN ('ACTIVE', 'RESERVED')
  OR (h.status = 'RETIRED' AND h.locked_until > :now)
  OR (h.status = 'PENDING' AND EXISTS (
      SELECT 1 FROM directory.entities e
       WHERE e.id = h.owner_entity_id AND (e.status <> 'DRAFT' OR e.created_at > :pendingCutoff))))`;

@Injectable()
export class HandlesRepository {
  constructor(private readonly sequelize: Sequelize) {}

  /** Serializes every claim of one skeleton across instances (released at commit). */
  async lockSkeleton(skeleton: string, transaction: Transaction): Promise<void> {
    await this.sequelize.query('SELECT pg_advisory_xact_lock(hashtext(:key))', {
      replacements: { key: `handle:${skeleton}` },
      transaction,
    });
  }

  async findByHandle(handle: string, transaction?: Transaction): Promise<HandleRow | null> {
    const [row] = await this.sequelize.query<HandleRow>(`SELECT ${COLUMNS} FROM directory.handles h WHERE h.handle = :handle`, {
      replacements: { handle },
      type: QueryTypes.SELECT,
      transaction,
    });
    return row ?? null;
  }

  /** The ACTIVE handle of a listing, or its PENDING reservation while it has not expired. */
  async findCurrent(entityId: string, now: Date, transaction?: Transaction): Promise<HandleRow | null> {
    const [row] = await this.sequelize.query<HandleRow>(
      `SELECT ${COLUMNS} FROM directory.handles h
        WHERE h.owner_entity_id = :entityId AND h.status IN ('PENDING', 'ACTIVE') AND ${HOLDS_SKELETON}`,
      { replacements: { entityId, now, pendingCutoff: pendingCutoff(now) }, type: QueryTypes.SELECT, transaction },
    );
    return row ?? null;
  }

  /** Rows of other listings (and REPP reservations) that hold this skeleton now. */
  findHolders(skeleton: string, exceptEntityId: string | null, now: Date, transaction?: Transaction): Promise<HandleRow[]> {
    return this.sequelize.query<HandleRow>(
      `SELECT ${COLUMNS} FROM directory.handles h
        WHERE h.skeleton = :skeleton AND ${HOLDS_SKELETON}
          AND (h.owner_entity_id IS NULL OR h.owner_entity_id IS DISTINCT FROM :exceptEntityId)`,
      {
        replacements: { skeleton, exceptEntityId, now, pendingCutoff: pendingCutoff(now) },
        type: QueryTypes.SELECT,
        transaction,
      },
    );
  }

  /** Expired rows of OTHER listings with this skeleton stop existing: their handle is free again. */
  async deleteExpired(skeleton: string, exceptEntityId: string, now: Date, transaction: Transaction): Promise<void> {
    await this.sequelize.query(
      `DELETE FROM directory.handles h
        WHERE h.skeleton = :skeleton AND h.status IN ('PENDING', 'RETIRED')
          AND h.owner_entity_id <> :exceptEntityId AND NOT ${HOLDS_SKELETON}`,
      { replacements: { skeleton, exceptEntityId, now, pendingCutoff: pendingCutoff(now) }, transaction },
    );
  }

  async insert(
    row: { handle: string; skeleton: string; ownerEntityId: string; status: 'PENDING' | 'ACTIVE' },
    transaction: Transaction,
  ): Promise<void> {
    await this.sequelize.query(
      `INSERT INTO directory.handles (handle, skeleton, owner_entity_id, status)
       VALUES (:handle, :skeleton, :ownerEntityId, :status)`,
      { replacements: row, transaction },
    );
  }

  async deleteHandle(handle: string, transaction: Transaction): Promise<void> {
    await this.sequelize.query('DELETE FROM directory.handles WHERE handle = :handle', { replacements: { handle }, transaction });
  }

  /** The old public handle redirects to the new one and stays locked for everyone else. */
  async retire(
    handle: string,
    change: { redirectTo: string; redirectUntil: Date; lockedUntil: Date },
    transaction: Transaction,
  ): Promise<void> {
    await this.sequelize.query(
      `UPDATE directory.handles
          SET status = 'RETIRED', redirect_to_handle = :redirectTo, redirect_until = :redirectUntil,
              locked_until = :lockedUntil, updated_at = now()
        WHERE handle = :handle`,
      { replacements: { handle, ...change }, transaction },
    );
  }

  /** Older retired handles of the listing point straight at the newest one: no redirect chains. */
  async repointRedirects(entityId: string, to: string, transaction: Transaction): Promise<void> {
    await this.sequelize.query(
      `UPDATE directory.handles SET redirect_to_handle = :to, updated_at = now()
        WHERE owner_entity_id = :entityId AND status = 'RETIRED' AND redirect_to_handle IS NOT NULL`,
      { replacements: { entityId, to }, transaction },
    );
  }

  /** A listing taking back one of its own retired handles. */
  async reactivate(handle: string, transaction: Transaction): Promise<void> {
    await this.sequelize.query(
      `UPDATE directory.handles
          SET status = 'ACTIVE', redirect_to_handle = NULL, redirect_until = NULL, locked_until = NULL, updated_at = now()
        WHERE handle = :handle`,
      { replacements: { handle }, transaction },
    );
  }

  async listPublicRenameTimes(entityId: string, transaction: Transaction): Promise<Date[]> {
    const rows = await this.sequelize.query<{ changedAt: Date }>(
      `SELECT changed_at AS "changedAt" FROM directory.handle_changes
        WHERE entity_id = :entityId AND reason = 'USER' AND from_handle IS NOT NULL
          AND changed_at > now() - interval '365 days'`,
      { replacements: { entityId }, type: QueryTypes.SELECT, transaction },
    );
    return rows.map((row) => row.changedAt);
  }

  /** Append-only record of every public rename. */
  async recordChange(
    change: { entityId: string; from: string | null; to: string; actorUserId: string; reason: 'USER' | 'REPP_FORCED' },
    transaction: Transaction,
  ): Promise<void> {
    await this.sequelize.query(
      `INSERT INTO directory.handle_changes (entity_id, from_handle, to_handle, actor_user_id, reason)
       VALUES (:entityId, :from, :to, :actorUserId, :reason)`,
      { replacements: change, transaction },
    );
  }
}

function pendingCutoff(now: Date): Date {
  return addDays(now, -PENDING_HANDLE_TTL_DAYS);
}
