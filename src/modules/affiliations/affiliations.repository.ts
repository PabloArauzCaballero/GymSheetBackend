import { Injectable } from '@nestjs/common';
import { DatabaseError, QueryTypes, Transaction, UniqueConstraintError } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import { AffiliationKind, AffiliationStatus } from './affiliation.catalog';

/** Who is affiliated: a person, or a coach business (acting through its account's user). */
export type Subject = { type: 'PERSON'; userId: string } | { type: 'COACH'; entityId: string; ownerUserId: string };

export type AffiliationRow = {
  id: string;
  gymEntityId: string;
  userId: string | null;
  coachEntityId: string | null;
  kind: AffiliationKind;
  status: AffiliationStatus;
  reasonCode: string | null;
};

/** A gym as a request sees it: public (ACTIVE) and with the business account that answers for it. */
export type GymRow = { entityId: string; name: string; status: string; ownerUserId: string };

export type Transition = {
  status: AffiliationStatus;
  changedByUserId: string | null;
  reasonCode?: string | null;
  reasonNote?: string | null;
};

/** Which partial unique index refused an insert or a confirmation (see migration 202611200901). */
export class AffiliationUniqueError extends Error {
  constructor(readonly index: string) {
    super(index);
  }
}

const ROW = `a.id, a.gym_entity_id AS "gymEntityId", a.user_id AS "userId", a.coach_entity_id AS "coachEntityId",
  a.kind, a.status, a.reason_code AS "reasonCode"`;

const subjectColumn = (subject: Subject) => (subject.type === 'PERSON' ? 'a.user_id' : 'a.coach_entity_id');
const subjectId = (subject: Subject) => (subject.type === 'PERSON' ? subject.userId : subject.entityId);

/** Writes of `directory.affiliations`; its history is written by the table's trigger, never here. */
@Injectable()
export class AffiliationsRepository {
  constructor(private readonly sequelize: Sequelize) {}

  transaction<T>(work: (transaction: Transaction) => Promise<T>): Promise<T> {
    return this.sequelize.transaction(work);
  }

  /**
   * The per-subject mutex: the person's account row (or the coach's entity)
   * `FOR NO KEY UPDATE`. Every affiliation write of a subject, and the account
   * closure (which locks the same row `FOR UPDATE`), queue here first, so
   * limits are counted once and no two paths take row locks in opposite order.
   */
  async lockSubject(subject: Subject, transaction: Transaction): Promise<void> {
    const sql =
      subject.type === 'PERSON'
        ? 'SELECT id FROM public.usuarios WHERE id = :id FOR NO KEY UPDATE'
        : 'SELECT id FROM directory.entities WHERE id = :id FOR NO KEY UPDATE';
    await this.sequelize.query(sql, { type: QueryTypes.SELECT, replacements: { id: subjectId(subject) }, transaction });
  }

  /** A gym by its ACTIVE @handle or its id; only a GYM entity with a business account is ever found. */
  async findGym(target: { handle: string } | { entityId: string }, transaction?: Transaction): Promise<GymRow | null> {
    const where = 'handle' in target
      ? `e.id = (SELECT h.owner_entity_id FROM directory.handles h WHERE h.handle = :value AND h.status = 'ACTIVE')`
      : 'e.id = :value';
    const [row] = await this.sequelize.query<GymRow>(
      `SELECT e.id AS "entityId", e.name, e.status, b.user_id AS "ownerUserId"
         FROM directory.entities e JOIN business.accounts b ON b.entity_id = e.id
        WHERE ${where} AND e.entity_type = 'GYM'`,
      { type: QueryTypes.SELECT, replacements: { value: 'handle' in target ? target.handle : target.entityId }, transaction },
    );
    return row ?? null;
  }

  /** Who is told about a subject's affiliation: the person, or the account of the coach business. */
  async recipientOf(row: AffiliationRow, transaction: Transaction): Promise<string | null> {
    if (row.userId) return row.userId;
    const [account] = await this.sequelize.query<{ userId: string }>('SELECT user_id AS "userId" FROM business.accounts WHERE entity_id = :entityId', {
      type: QueryTypes.SELECT,
      replacements: { entityId: row.coachEntityId },
      transaction,
    });
    return account?.userId ?? null;
  }

  async locationOfGym(gymEntityId: string, locationId: string, transaction: Transaction): Promise<boolean> {
    const rows = await this.sequelize.query(
      'SELECT 1 FROM directory.entity_locations WHERE id = :locationId AND entity_id = :gymEntityId',
      { type: QueryTypes.SELECT, replacements: { gymEntityId, locationId }, transaction },
    );
    return rows.length > 0;
  }

  /** The subject's live (REQUESTED or CONFIRMED) rows: few by construction (limits and unique indexes). */
  liveOf(subject: Subject, transaction: Transaction): Promise<AffiliationRow[]> {
    return this.sequelize.query<AffiliationRow>(
      `SELECT ${ROW} FROM directory.affiliations a WHERE ${subjectColumn(subject)} = :id AND a.status IN ('REQUESTED', 'CONFIRMED')`,
      { type: QueryTypes.SELECT, replacements: { id: subjectId(subject) }, transaction },
    );
  }

  /** The latest closed row of the subject with this gym and kind: the cooldown reads it. */
  async lastClosed(subject: Subject, gymEntityId: string, kind: AffiliationKind, transaction: Transaction) {
    const [row] = await this.sequelize.query<{ reasonCode: string; closedAt: Date }>(
      `SELECT a.reason_code AS "reasonCode", a.closed_at AS "closedAt" FROM directory.affiliations a
        WHERE ${subjectColumn(subject)} = :id AND a.gym_entity_id = :gymEntityId AND a.kind = :kind AND a.closed_at IS NOT NULL
        ORDER BY a.closed_at DESC LIMIT 1`,
      { type: QueryTypes.SELECT, replacements: { id: subjectId(subject), gymEntityId, kind }, transaction },
    );
    return row ?? null;
  }

  async insert(
    input: { subject: Subject; gymEntityId: string; kind: AffiliationKind; locationId: string | null; ciLast3: string | null; replacesId: string | null },
    transaction: Transaction,
  ): Promise<string> {
    const [row] = await this.run<{ id: string }>(
      `INSERT INTO directory.affiliations
         (gym_entity_id, user_id, coach_entity_id, kind, location_id, ci_last3, replaces_affiliation_id, changed_by_user_id)
       VALUES (:gymEntityId, :userId, :coachEntityId, :kind, :locationId, :ciLast3, :replacesId, :actor) RETURNING id`,
      {
        gymEntityId: input.gymEntityId,
        userId: input.subject.type === 'PERSON' ? input.subject.userId : null,
        coachEntityId: input.subject.type === 'COACH' ? input.subject.entityId : null,
        kind: input.kind,
        locationId: input.locationId,
        ciLast3: input.ciLast3,
        replacesId: input.replacesId,
        actor: input.subject.type === 'PERSON' ? input.subject.userId : input.subject.ownerUserId,
      },
      transaction,
    );
    return row.id;
  }

  /** The row locked `FOR UPDATE`, or null. Callers scope it (subject or gym) and answer 404 otherwise. */
  async lock(affiliationId: string, transaction: Transaction): Promise<AffiliationRow | null> {
    const [row] = await this.sequelize.query<AffiliationRow>(`SELECT ${ROW} FROM directory.affiliations a WHERE a.id = :affiliationId FOR UPDATE`, {
      type: QueryTypes.SELECT,
      replacements: { affiliationId },
      transaction,
    });
    return row ?? null;
  }

  async find(affiliationId: string, transaction?: Transaction): Promise<AffiliationRow | null> {
    const [row] = await this.sequelize.query<AffiliationRow>(`SELECT ${ROW} FROM directory.affiliations a WHERE a.id = :affiliationId`, {
      type: QueryTypes.SELECT,
      replacements: { affiliationId },
      transaction,
    });
    return row ?? null;
  }

  /** The person's CONFIRMED SOCIO, locked (the gym switch ends it); `ux_affiliations_confirmed_socio`. */
  async lockConfirmedSocio(userId: string, transaction: Transaction): Promise<AffiliationRow | null> {
    const [row] = await this.sequelize.query<AffiliationRow>(
      `SELECT ${ROW} FROM directory.affiliations a WHERE a.user_id = :userId AND a.kind = 'SOCIO' AND a.status = 'CONFIRMED' FOR UPDATE`,
      { type: QueryTypes.SELECT, replacements: { userId }, transaction },
    );
    return row ?? null;
  }

  /**
   * «Mi gimnasio» of a person (the read 7c moves to): their single CONFIRMED
   * SOCIO, one index probe on `ux_affiliations_confirmed_socio`. Null when
   * they are nobody's member.
   */
  async findCurrentSocio(userId: string): Promise<{ affiliationId: string; gymEntityId: string; locationId: string | null; since: Date } | null> {
    const [row] = await this.sequelize.query<{ affiliationId: string; gymEntityId: string; locationId: string | null; since: Date }>(
      `SELECT id AS "affiliationId", gym_entity_id AS "gymEntityId", location_id AS "locationId", confirmed_at AS since
         FROM directory.affiliations WHERE user_id = :userId AND kind = 'SOCIO' AND status = 'CONFIRMED'`,
      { type: QueryTypes.SELECT, replacements: { userId } },
    );
    return row ?? null;
  }

  /** One status change; the dates follow the status and the trigger appends the history row. */
  async transition(affiliationId: string, change: Transition, transaction: Transaction): Promise<void> {
    await this.run(
      `UPDATE directory.affiliations
          SET status = :status, changed_by_user_id = :changedByUserId, reason_code = :reasonCode, reason_note = :reasonNote,
              confirmed_at = CASE WHEN :status = 'CONFIRMED' THEN now() ELSE confirmed_at END,
              closed_at = CASE WHEN :status IN ('REJECTED', 'ENDED', 'CANCELLED') THEN now() ELSE NULL END,
              updated_at = now()
        WHERE id = :affiliationId`,
      { affiliationId, reasonCode: null, reasonNote: null, ...change },
      transaction,
    );
  }

  private async run<T extends object>(sql: string, replacements: Record<string, unknown>, transaction: Transaction): Promise<T[]> {
    try {
      return await this.sequelize.query<T>(sql, { type: QueryTypes.SELECT, replacements, transaction });
    } catch (error: unknown) {
      if (error instanceof UniqueConstraintError) throw new AffiliationUniqueError(violated(error));
      throw error;
    }
  }
}

/** Name of the constraint or index a database error reports, when it reports one. */
export function violated(error: unknown): string {
  const original = error instanceof DatabaseError || error instanceof UniqueConstraintError ? (error.original as { constraint?: unknown }) : null;
  return typeof original?.constraint === 'string' ? original.constraint : '';
}
