import {
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { QueryTypes, Transaction } from "sequelize";
import { Sequelize } from "sequelize-typescript";

export type SharedSessionSnapshot = {
  inviteId: string;
  routineId: string;
  revision: number;
  name: string;
  exercises: Array<{
    exerciseId: string;
    exerciseName: string;
    order: number;
    targetSets: number;
    repsMin: number | null;
    repsMax: number | null;
    restSeconds: number | null;
  }>;
};

type SnapshotRow = {
  invite_id: string;
  source_routine_id: string;
  accepted_revision: number;
  snapshot: SharedSessionSnapshot;
};

/**
 * Stores only the agreed routine prescription. Completed sets, actual loads,
 * notes, and other workout history stay in each athlete's private session.
 */
@Injectable()
export class SharedSessionService {
  constructor(private readonly sequelize: Sequelize) {}

  async snapshotForAcceptedRevision(
    inviteId: string,
    routineId: string,
    revision: number,
    snapshot: Omit<
      SharedSessionSnapshot,
      "inviteId" | "routineId" | "revision"
    >,
    transaction: Transaction,
  ): Promise<void> {
    await this.sequelize.query<{ id: string }>(
      `INSERT INTO training.training_invite_shared_snapshots
         (invite_id, source_routine_id, accepted_revision, snapshot)
       VALUES (:inviteId, :routineId, :revision, CAST(:snapshot AS jsonb))
       ON CONFLICT (invite_id) DO NOTHING
       RETURNING invite_id AS id`,
      {
        type: QueryTypes.SELECT,
        replacements: {
          inviteId,
          routineId,
          revision,
          snapshot: JSON.stringify(snapshot),
        },
        transaction,
      },
    );

    const existing = await this.sequelize.query<SnapshotRow>(
      `SELECT invite_id, source_routine_id, accepted_revision, snapshot
         FROM training.training_invite_shared_snapshots
        WHERE invite_id = :inviteId FOR UPDATE`,
      { type: QueryTypes.SELECT, replacements: { inviteId }, transaction },
    );
    if (
      !existing[0] ||
      existing[0].source_routine_id !== routineId ||
      existing[0].accepted_revision !== revision
    ) {
      throw new ConflictException(
        "No se pudo conservar la rutina compartida acordada.",
      );
    }
  }

  async getForParticipant(
    inviteId: string,
    userId: string,
  ): Promise<SharedSessionSnapshot> {
    const participant = await this.sequelize.query<{ state: string }>(
      `SELECT state FROM training.training_invites
        WHERE id = :inviteId AND (inviter_id = :userId OR recipient_id = :userId)`,
      { type: QueryTypes.SELECT, replacements: { inviteId, userId } },
    );
    if (!participant[0])
      throw new NotFoundException("Invitación no encontrada.");
    if (participant[0].state !== "ACCEPTED") {
      throw new ConflictException(
        "La invitación debe estar aceptada para ver la rutina compartida.",
      );
    }

    const rows = await this.sequelize.query<SnapshotRow>(
      `SELECT s.invite_id, s.source_routine_id, s.accepted_revision, s.snapshot
         FROM training.training_invite_shared_snapshots s
         JOIN training.training_invite_meetings m ON m.invite_id = s.invite_id
         JOIN training.training_invites i ON i.id = s.invite_id
        WHERE s.invite_id = :inviteId AND i.state = 'ACCEPTED'
          AND (i.inviter_id = :userId OR i.recipient_id = :userId)`,
      { type: QueryTypes.SELECT, replacements: { inviteId, userId } },
    );
    if (!rows[0])
      throw new NotFoundException(
        "La invitación no tiene una rutina compartida.",
      );
    return {
      ...rows[0].snapshot,
      inviteId: rows[0].invite_id,
      routineId: rows[0].source_routine_id,
      revision: rows[0].accepted_revision,
    };
  }
}
