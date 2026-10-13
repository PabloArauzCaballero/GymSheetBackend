import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";
import { QueryTypes, Transaction, UniqueConstraintError } from "sequelize";
import { Sequelize } from "sequelize-typescript";
import { lockSocialPairUsers } from "../social/social-pair-lock";
import { ChatRepository } from "../chat/chat.repository";
import {
  SharedSessionService,
  SharedSessionSnapshot,
} from "./shared-session.service";
import {
  CounterproposeTrainingInviteInput,
  CreateTrainingInviteInput,
  RespondTrainingInviteInput,
} from "./training-invite.schemas";

type InviteRow = {
  id: string;
  inviter_id: string;
  recipient_id: string;
  state: string;
  current_revision: number;
  created_at: Date;
  updated_at: Date;
  responded_by_user_id?: string | null;
  responded_revision?: number | null;
  responded_at?: Date | null;
};

type RevisionRow = {
  invite_id: string;
  revision: number;
  proposer_id: string;
  starts_at: Date;
  time_zone: string;
  duration_minutes: number;
  place_kind: "GYM" | "PUBLIC_PLACE";
  place_id: string | null;
  place_label: string;
  mode: "OWN_ROUTINES" | "SHARED_SESSION";
  routine_session_id: string | null;
  routine_snapshot?: Omit<
    SharedSessionSnapshot,
    "inviteId" | "routineId" | "revision"
  > | null;
  note: string | null;
  created_at: Date;
};

type BranchRow = { id: string; name: string };

type InviteListRow = InviteRow & {
  revision_proposer_id: string;
  revision_starts_at: Date;
  revision_time_zone: string;
  revision_duration_minutes: number;
  revision_place_kind: "GYM" | "PUBLIC_PLACE";
  revision_place_id: string | null;
  revision_place_label: string;
  revision_mode: "OWN_ROUTINES" | "SHARED_SESSION";
  revision_routine_session_id: string | null;
  revision_note: string | null;
  revision_created_at: Date;
  meeting_id: string | null;
  meeting_accepted_revision: number | null;
  meeting_starts_at: Date | null;
  meeting_time_zone: string | null;
  meeting_place_label: string | null;
  meeting_cancelled_at: Date | null;
};

@Injectable()
export class TrainingInvitationsService {
  constructor(
    private readonly sequelize: Sequelize,
    private readonly chatRepository: ChatRepository,
    private readonly sharedSessions: SharedSessionService,
  ) {}

  async listForUser(userId: string) {
    // The participant predicate applies before projection. A cancelled invite
    // remains visible to both people, even when their connection is gone.
    const rows = await this.sequelize.query<InviteListRow>(
      `SELECT i.id, i.inviter_id, i.recipient_id, i.state,
              i.current_revision, i.created_at, i.updated_at,
              i.responded_by_user_id, i.responded_revision, i.responded_at,
              r.proposer_id AS revision_proposer_id,
              r.starts_at AS revision_starts_at,
              r.time_zone AS revision_time_zone,
              r.duration_minutes AS revision_duration_minutes,
              r.place_kind AS revision_place_kind,
              r.place_id AS revision_place_id,
              r.place_label AS revision_place_label,
              r.mode AS revision_mode,
              r.routine_session_id AS revision_routine_session_id,
              r.note AS revision_note,
              r.created_at AS revision_created_at,
              m.id AS meeting_id,
              m.accepted_revision AS meeting_accepted_revision,
              m.starts_at AS meeting_starts_at,
              m.time_zone AS meeting_time_zone,
              m.place_label AS meeting_place_label,
              m.cancelled_at AS meeting_cancelled_at
         FROM training.training_invites i
         JOIN training.training_invite_revisions r
           ON r.invite_id = i.id AND r.revision = i.current_revision
         LEFT JOIN training.training_invite_meetings m ON m.invite_id = i.id
        WHERE i.inviter_id = :userId OR i.recipient_id = :userId
        ORDER BY i.updated_at DESC, i.id DESC`,
      { type: QueryTypes.SELECT, replacements: { userId } },
    );
    return rows.map((row) => ({
      ...this.project(row, {
        invite_id: row.id,
        revision: row.current_revision,
        proposer_id: row.revision_proposer_id,
        starts_at: row.revision_starts_at,
        time_zone: row.revision_time_zone,
        duration_minutes: row.revision_duration_minutes,
        place_kind: row.revision_place_kind,
        place_id: row.revision_place_id,
        place_label: row.revision_place_label,
        mode: row.revision_mode,
        routine_session_id: row.revision_routine_session_id,
        note: row.revision_note,
        created_at: row.revision_created_at,
      }),
      response: row.responded_at
        ? {
            decision:
              row.state === "DECLINED"
                ? ("DECLINE" as const)
                : ("ACCEPT" as const),
            respondedBy: row.responded_by_user_id,
            revision: row.responded_revision,
            respondedAt: new Date(row.responded_at).toISOString(),
          }
        : null,
      meeting: row.meeting_id
        ? {
            id: row.meeting_id,
            acceptedRevision: row.meeting_accepted_revision,
            startsAt: new Date(row.meeting_starts_at!).toISOString(),
            timeZone: row.meeting_time_zone,
            placeLabel: row.meeting_place_label,
            cancelledAt: row.meeting_cancelled_at
              ? new Date(row.meeting_cancelled_at).toISOString()
              : null,
          }
        : null,
    }));
  }

  getSharedSession(inviteId: string, userId: string) {
    return this.sharedSessions.getForParticipant(inviteId, userId);
  }

  async create(
    inviterId: string,
    tenantId: string,
    input: CreateTrainingInviteInput,
  ) {
    if (inviterId === input.recipientId) {
      throw new BadRequestException("No puedes invitarte a ti mismo.");
    }
    const startsAt = Date.parse(input.startsAt);
    if (startsAt <= Date.now()) {
      throw new UnprocessableEntityException(
        "La fecha de la invitación debe estar en el futuro.",
      );
    }
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: input.timeZone }).format(
        new Date(startsAt),
      );
    } catch {
      throw new BadRequestException(
        "timeZone debe ser un identificador IANA válido.",
      );
    }

    try {
      return await this.sequelize.transaction(async (transaction) => {
        // Uses the same stable pair lock as connection removal/blocking, so a
        // revocation cannot race the authorization check and invitation insert.
        await lockSocialPairUsers(
          this.sequelize,
          inviterId,
          input.recipientId,
          transaction,
        );
        const activeUsers = await this.select<{ id: string }>(
          `SELECT id FROM public.usuarios
            WHERE id IN (:inviterId, :recipientId) AND estado = 'ACTIVO'
            ORDER BY id FOR UPDATE`,
          { inviterId, recipientId: input.recipientId },
          transaction,
        );
        if (activeUsers.length !== 2)
          throw new NotFoundException("No encontramos a esa conexión.");

        const acceptedConnection = await this.select<{ id: string }>(
          `SELECT c.id
             FROM social.connections c
            WHERE c.status = 'ACCEPTED'
              AND ((c.requester_id = :inviterId AND c.addressee_id = :recipientId)
                OR (c.requester_id = :recipientId AND c.addressee_id = :inviterId))
              AND NOT EXISTS (
                SELECT 1 FROM social.user_blocks b
                 WHERE (b.blocker_id = :inviterId AND b.blocked_id = :recipientId)
                    OR (b.blocker_id = :recipientId AND b.blocked_id = :inviterId)
              )
            FOR UPDATE`,
          { inviterId, recipientId: input.recipientId },
          transaction,
        );
        if (acceptedConnection.length !== 1) {
          throw new ForbiddenException(
            "Solo puedes invitar a una conexión activa.",
          );
        }

        const existing = await this.select<InviteRow>(
          `SELECT id, inviter_id, recipient_id, state, current_revision, created_at, updated_at,
                  request_fingerprint
             FROM training.training_invites
            WHERE inviter_id = :inviterId AND client_request_id = :clientRequestId`,
          { inviterId, clientRequestId: input.clientRequestId },
          transaction,
        );

        let normalizedPlace: {
          kind: "GYM" | "PUBLIC_PLACE";
          placeId: string | null;
          label: string;
        };
        if (input.place.kind === "GYM") {
          const branches = await this.select<BranchRow>(
            `SELECT id, name FROM facilities.branches
              WHERE id = :placeId AND tenant_id = :tenantId AND status = 'ACTIVE'`,
            { placeId: input.place.placeId, tenantId },
            transaction,
          );
          if (!branches[0])
            throw new NotFoundException("No encontramos ese gimnasio activo.");
          normalizedPlace = {
            kind: "GYM",
            placeId: branches[0].id,
            label: branches[0].name,
          };
        } else {
          normalizedPlace = {
            kind: "PUBLIC_PLACE",
            placeId: input.place.placeId ?? null,
            label: input.place.label,
          };
        }

        let routineSnapshot: Omit<
          SharedSessionSnapshot,
          "inviteId" | "routineId" | "revision"
        > | null = null;
        if (input.mode === "SHARED_SESSION") {
          const accessibleRoutine = await this.select<{ id: string }>(
            `SELECT r.id
               FROM training.routines r
              WHERE r.id = :routineId AND r.estado = 'ACTIVE' AND r.hidden_at IS NULL
                AND (r.created_by_user_id = :inviterId OR EXISTS (
                  SELECT 1 FROM training.routine_assignments a
                   WHERE a.routine_id = r.id AND a.cliente_user_id = :inviterId AND a.estado = 'ACTIVE'
                ))`,
            { routineId: input.routineSessionId, inviterId },
            transaction,
          );
          if (!accessibleRoutine.length)
            throw new NotFoundException(
              "No encontramos esa sesión autorizada.",
            );
          routineSnapshot = await this.captureRoutineSnapshot(
            input.routineSessionId!,
            transaction,
          );
        }

        const fingerprint = this.fingerprint({
          recipientId: input.recipientId,
          startsAt: new Date(startsAt).toISOString(),
          timeZone: input.timeZone,
          durationMinutes: input.durationMinutes,
          place: normalizedPlace,
          mode: input.mode,
          routineSessionId: input.routineSessionId ?? null,
          note: input.note?.trim() || null,
        });
        if (existing[0]) {
          const existingFingerprint = (
            existing[0] as InviteRow & { request_fingerprint: string }
          ).request_fingerprint.trim();
          if (existingFingerprint !== fingerprint) {
            throw new ConflictException(
              "clientRequestId ya se usó con otra invitación.",
            );
          }
          const priorRevision = await this.select<RevisionRow>(
            `SELECT * FROM training.training_invite_revisions
              WHERE invite_id = :inviteId AND revision = :revision`,
            {
              inviteId: existing[0].id,
              revision: existing[0].current_revision,
            },
            transaction,
          );
          if (!priorRevision[0])
            throw new ConflictException(
              "La invitación previa no tiene revisión válida.",
            );
          return this.project(existing[0], priorRevision[0]);
        }

        const inviteId = randomUUID();
        const inserted = await this.select<InviteRow>(
          `INSERT INTO training.training_invites
             (id, inviter_id, recipient_id, state, current_revision, client_request_id, request_fingerprint)
           VALUES (:id, :inviterId, :recipientId, 'PENDING', 1, :clientRequestId, :fingerprint)
           RETURNING id, inviter_id, recipient_id, state, current_revision, created_at, updated_at`,
          {
            id: inviteId,
            inviterId,
            recipientId: input.recipientId,
            clientRequestId: input.clientRequestId,
            fingerprint,
          },
          transaction,
        );
        const revisions = await this.select<RevisionRow>(
          `INSERT INTO training.training_invite_revisions
             (invite_id, revision, proposer_id, starts_at, time_zone, duration_minutes,
              place_kind, place_id, place_label, mode, routine_session_id, note, routine_snapshot)
           VALUES
             (:inviteId, 1, :proposerId, :startsAt, :timeZone, :durationMinutes,
              :placeKind, :placeId, :placeLabel, :mode, :routineSessionId, :note, CAST(:routineSnapshot AS jsonb))
           RETURNING *`,
          {
            inviteId,
            proposerId: inviterId,
            startsAt: new Date(startsAt).toISOString(),
            timeZone: input.timeZone,
            durationMinutes: input.durationMinutes,
            placeKind: normalizedPlace.kind,
            placeId: normalizedPlace.placeId,
            placeLabel: normalizedPlace.label,
            mode: input.mode,
            routineSessionId: input.routineSessionId ?? null,
            note: input.note?.trim() || null,
            routineSnapshot: routineSnapshot
              ? JSON.stringify(routineSnapshot)
              : null,
          },
          transaction,
        );
        if (!inserted[0] || !revisions[0])
          throw new ConflictException("No se pudo guardar la invitación.");
        return this.project(inserted[0], revisions[0]);
      });
    } catch (error) {
      if (error instanceof UniqueConstraintError) {
        throw new ConflictException(
          "Ya existe una invitación pendiente para esta conexión.",
        );
      }
      throw error;
    }
  }

  async respond(
    actorId: string,
    inviteId: string,
    input: RespondTrainingInviteInput,
  ) {
    const requestFingerprint = this.fingerprint({
      inviteId,
      decision: input.decision,
      expectedRevision: input.expectedRevision,
    });
    let requestExpired = false;

    try {
      const result = await this.sequelize.transaction(async (transaction) => {
        const initial = await this.select<InviteRow>(
          `SELECT id, inviter_id, recipient_id, state, current_revision,
                  created_at, updated_at
             FROM training.training_invites WHERE id = :inviteId`,
          { inviteId },
          transaction,
        );
        if (
          !initial[0] ||
          (initial[0].recipient_id !== actorId &&
            initial[0].inviter_id !== actorId)
        ) {
          throw new NotFoundException("No encontramos esa invitación.");
        }

        await lockSocialPairUsers(
          this.sequelize,
          initial[0].inviter_id,
          initial[0].recipient_id,
          transaction,
        );
        const activeUsers = await this.select<{ id: string }>(
          `SELECT id FROM public.usuarios
            WHERE id IN (:inviterId, :recipientId) AND estado = 'ACTIVO'
            ORDER BY id FOR UPDATE`,
          {
            inviterId: initial[0].inviter_id,
            recipientId: initial[0].recipient_id,
          },
          transaction,
        );
        if (activeUsers.length !== 2) {
          throw new ForbiddenException(
            "La conexión ya no está disponible para esta invitación.",
          );
        }
        const acceptedConnection = await this.select<{ id: string }>(
          `SELECT c.id
             FROM social.connections c
            WHERE c.status = 'ACCEPTED'
              AND ((c.requester_id = :inviterId AND c.addressee_id = :recipientId)
                OR (c.requester_id = :recipientId AND c.addressee_id = :inviterId))
              AND NOT EXISTS (
                SELECT 1 FROM social.user_blocks b
                 WHERE (b.blocker_id = :inviterId AND b.blocked_id = :recipientId)
                    OR (b.blocker_id = :recipientId AND b.blocked_id = :inviterId)
              )
            FOR UPDATE`,
          {
            inviterId: initial[0].inviter_id,
            recipientId: initial[0].recipient_id,
          },
          transaction,
        );
        if (acceptedConnection.length !== 1) {
          throw new ForbiddenException(
            "La conexión ya no está disponible para esta invitación.",
          );
        }

        const lockedRows = await this.select<InviteRow>(
          `SELECT id, inviter_id, recipient_id, state, current_revision,
                  created_at, updated_at, responded_by_user_id,
                  responded_revision, responded_at
             FROM training.training_invites WHERE id = :inviteId FOR UPDATE`,
          { inviteId },
          transaction,
        );
        const invite = lockedRows[0];
        if (
          !invite ||
          (invite.recipient_id !== actorId && invite.inviter_id !== actorId)
        ) {
          throw new NotFoundException("No encontramos esa invitación.");
        }

        const currentRevision = await this.select<{
          proposer_id: string;
          starts_at: Date;
        }>(
          `SELECT proposer_id, starts_at FROM training.training_invite_revisions
            WHERE invite_id = :inviteId AND revision = :revision`,
          { inviteId, revision: invite.current_revision },
          transaction,
        );
        if (!currentRevision[0]) {
          throw new ConflictException(
            "La invitación no tiene revisión válida.",
          );
        }

        const priorCommand = await this.select<{
          invite_id: string;
          request_fingerprint: string;
          result_state: string;
        }>(
          `SELECT invite_id, request_fingerprint, result_state
             FROM training.training_invite_commands
            WHERE actor_user_id = :actorId AND command_type = 'RESPOND'
              AND client_request_id = :clientRequestId`,
          { actorId, clientRequestId: input.clientRequestId },
          transaction,
        );
        if (priorCommand[0]) {
          if (
            priorCommand[0].invite_id !== inviteId ||
            priorCommand[0].request_fingerprint.trim() !== requestFingerprint
          ) {
            throw new ConflictException(
              "clientRequestId ya se usó con otra respuesta.",
            );
          }
          if (priorCommand[0].result_state === "ACCEPTED") {
            await this.ensureAcceptedMeetingAndChatEvent(invite, transaction);
          } else if (priorCommand[0].result_state === "EXPIRED") {
            requestExpired = true;
          }
          return this.projectCurrentInvite(invite, transaction);
        }

        const terminalState =
          input.decision === "ACCEPT" ? "ACCEPTED" : "DECLINED";
        if (
          invite.state === terminalState &&
          invite.responded_by_user_id === actorId &&
          invite.responded_revision === input.expectedRevision
        ) {
          // A different request ID can safely retry the same terminal response.
          if (input.decision === "ACCEPT") {
            await this.ensureAcceptedMeetingAndChatEvent(invite, transaction);
          }
          await this.insertResponseCommand(
            inviteId,
            actorId,
            input,
            requestFingerprint,
            transaction,
            terminalState,
          );
          return this.projectCurrentInvite(invite, transaction);
        }
        if (currentRevision[0].proposer_id === actorId) {
          throw new ConflictException(
            "Debes esperar la respuesta de la otra persona.",
          );
        }
        if (invite.state !== "PENDING") {
          throw new ConflictException("La invitación ya no está pendiente.");
        }
        if (invite.current_revision !== input.expectedRevision) {
          throw new ConflictException(
            "La invitación cambió; revisa su revisión actual.",
          );
        }

        const expiredRows = await this.select<InviteRow>(
          `UPDATE training.training_invites i
              SET state = 'EXPIRED', updated_at = now()
            WHERE i.id = :inviteId AND i.state = 'PENDING'
              AND i.current_revision = :revision
              AND EXISTS (
                SELECT 1 FROM training.training_invite_revisions r
                 WHERE r.invite_id = i.id AND r.revision = i.current_revision
                   AND r.starts_at <= clock_timestamp()
              )
            RETURNING i.id, i.inviter_id, i.recipient_id, i.state,
                      i.current_revision, i.created_at, i.updated_at,
                      i.responded_by_user_id, i.responded_revision, i.responded_at`,
          { inviteId, revision: input.expectedRevision },
          transaction,
        );
        if (expiredRows[0]) {
          requestExpired = true;
          await this.insertResponseCommand(
            inviteId,
            actorId,
            input,
            requestFingerprint,
            transaction,
            "EXPIRED",
          );
          return this.projectCurrentInvite(expiredRows[0], transaction);
        }

        const respondedRows = await this.select<InviteRow>(
          `UPDATE training.training_invites
              SET state = :terminalState, responded_by_user_id = :actorId,
                  responded_revision = :revision, responded_at = now(), updated_at = now()
            WHERE id = :inviteId AND state = 'PENDING' AND current_revision = :revision
            RETURNING id, inviter_id, recipient_id, state, current_revision,
                      created_at, updated_at, responded_by_user_id,
                      responded_revision, responded_at`,
          {
            actorId,
            inviteId,
            revision: input.expectedRevision,
            terminalState,
          },
          transaction,
        );
        if (!respondedRows[0]) {
          throw new ConflictException(
            "La invitación cambió; revisa su revisión actual.",
          );
        }
        await this.insertResponseCommand(
          inviteId,
          actorId,
          input,
          requestFingerprint,
          transaction,
          terminalState,
        );
        if (input.decision === "ACCEPT") {
          await this.ensureAcceptedMeetingAndChatEvent(
            respondedRows[0],
            transaction,
          );
        }
        return this.projectCurrentInvite(respondedRows[0], transaction);
      });
      if (requestExpired) {
        throw new ConflictException(
          "La invitación expiró al llegar su hora de inicio.",
        );
      }
      return result;
    } catch (error) {
      if (error instanceof UniqueConstraintError) {
        throw new ConflictException(
          "clientRequestId ya se usó con otra respuesta.",
        );
      }
      throw error;
    }
  }

  async counterpropose(
    actorId: string,
    tenantId: string,
    inviteId: string,
    input: CounterproposeTrainingInviteInput,
  ) {
    const startsAt = Date.parse(input.startsAt);
    if (!Number.isFinite(startsAt))
      throw new BadRequestException("startsAt debe ser una fecha válida.");
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: input.timeZone }).format(
        new Date(startsAt),
      );
    } catch {
      throw new BadRequestException(
        "timeZone debe ser un identificador IANA válido.",
      );
    }

    const fingerprint = this.fingerprint({
      inviteId,
      expectedRevision: input.expectedRevision,
      startsAt: new Date(startsAt).toISOString(),
      timeZone: input.timeZone,
      durationMinutes: input.durationMinutes,
      place:
        input.place.kind === "GYM"
          ? { kind: input.place.kind, placeId: input.place.placeId }
          : {
              kind: input.place.kind,
              placeId: input.place.placeId ?? null,
              label: input.place.label.trim(),
            },
      mode: input.mode,
      routineSessionId: input.routineSessionId ?? null,
      note: input.note?.trim() || null,
    });

    try {
      return await this.sequelize.transaction(async (transaction) => {
        const initial = await this.select<InviteRow>(
          `SELECT id, inviter_id, recipient_id, state, current_revision,
                created_at, updated_at
           FROM training.training_invites WHERE id = :inviteId`,
          { inviteId },
          transaction,
        );
        if (
          !initial[0] ||
          (initial[0].recipient_id !== actorId &&
            initial[0].inviter_id !== actorId)
        ) {
          throw new NotFoundException("No encontramos esa invitación.");
        }

        await lockSocialPairUsers(
          this.sequelize,
          initial[0].inviter_id,
          initial[0].recipient_id,
          transaction,
        );
        const activeUsers = await this.select<{ id: string }>(
          `SELECT id FROM public.usuarios
          WHERE id IN (:inviterId, :recipientId) AND estado = 'ACTIVO'
          ORDER BY id FOR UPDATE`,
          {
            inviterId: initial[0].inviter_id,
            recipientId: initial[0].recipient_id,
          },
          transaction,
        );
        if (activeUsers.length !== 2) {
          throw new ForbiddenException(
            "La conexión ya no está disponible para esta invitación.",
          );
        }
        const acceptedConnection = await this.select<{ id: string }>(
          `SELECT c.id
           FROM social.connections c
          WHERE c.status = 'ACCEPTED'
            AND ((c.requester_id = :inviterId AND c.addressee_id = :recipientId)
              OR (c.requester_id = :recipientId AND c.addressee_id = :inviterId))
            AND NOT EXISTS (
              SELECT 1 FROM social.user_blocks b
               WHERE (b.blocker_id = :inviterId AND b.blocked_id = :recipientId)
                  OR (b.blocker_id = :recipientId AND b.blocked_id = :inviterId)
            )
          FOR UPDATE`,
          {
            inviterId: initial[0].inviter_id,
            recipientId: initial[0].recipient_id,
          },
          transaction,
        );
        if (acceptedConnection.length !== 1) {
          throw new ForbiddenException(
            "La conexión ya no está disponible para esta invitación.",
          );
        }

        const lockedRows = await this.select<InviteRow>(
          `SELECT id, inviter_id, recipient_id, state, current_revision,
                created_at, updated_at
           FROM training.training_invites WHERE id = :inviteId FOR UPDATE`,
          { inviteId },
          transaction,
        );
        const invite = lockedRows[0];
        if (
          !invite ||
          (invite.recipient_id !== actorId && invite.inviter_id !== actorId)
        ) {
          throw new NotFoundException("No encontramos esa invitación.");
        }

        const priorCommand = await this.select<{
          invite_id: string;
          request_fingerprint: string;
        }>(
          `SELECT invite_id, request_fingerprint
           FROM training.training_invite_commands
          WHERE actor_user_id = :actorId AND command_type = 'COUNTERPROPOSE'
            AND client_request_id = :clientRequestId`,
          { actorId, clientRequestId: input.clientRequestId },
          transaction,
        );
        if (priorCommand[0]) {
          if (
            priorCommand[0].invite_id !== inviteId ||
            priorCommand[0].request_fingerprint.trim() !== fingerprint
          ) {
            throw new ConflictException(
              "clientRequestId ya se usó con otra contrapropuesta.",
            );
          }
          return this.projectCurrentInvite(invite, transaction);
        }

        if (startsAt <= Date.now()) {
          throw new UnprocessableEntityException(
            "La fecha de la contrapropuesta debe estar en el futuro.",
          );
        }

        if (invite.state !== "PENDING") {
          throw new ConflictException("La invitación ya no está pendiente.");
        }
        if (invite.current_revision !== input.expectedRevision) {
          throw new ConflictException(
            "La invitación cambió; revisa su revisión actual.",
          );
        }

        const currentRevision = await this.select<{ proposer_id: string }>(
          `SELECT proposer_id FROM training.training_invite_revisions
          WHERE invite_id = :inviteId AND revision = :revision`,
          { inviteId, revision: invite.current_revision },
          transaction,
        );
        if (!currentRevision[0]) {
          throw new ConflictException(
            "La invitación no tiene revisión válida.",
          );
        }
        if (currentRevision[0].proposer_id === actorId) {
          throw new ConflictException(
            "Debes esperar la respuesta de la otra persona.",
          );
        }

        let normalizedPlace: {
          kind: "GYM" | "PUBLIC_PLACE";
          placeId: string | null;
          label: string;
        };
        if (input.place.kind === "GYM") {
          const branches = await this.select<BranchRow>(
            `SELECT id, name FROM facilities.branches
            WHERE id = :placeId AND tenant_id = :tenantId AND status = 'ACTIVE'`,
            { placeId: input.place.placeId, tenantId },
            transaction,
          );
          if (!branches[0]) {
            throw new NotFoundException("No encontramos ese gimnasio activo.");
          }
          normalizedPlace = {
            kind: "GYM",
            placeId: branches[0].id,
            label: branches[0].name,
          };
        } else {
          normalizedPlace = {
            kind: "PUBLIC_PLACE",
            placeId: input.place.placeId ?? null,
            label: input.place.label,
          };
        }

        let routineSnapshot: Omit<
          SharedSessionSnapshot,
          "inviteId" | "routineId" | "revision"
        > | null = null;
        if (input.mode === "SHARED_SESSION") {
          const accessibleRoutine = await this.select<{ id: string }>(
            `SELECT r.id
             FROM training.routines r
            WHERE r.id = :routineId AND r.estado = 'ACTIVE' AND r.hidden_at IS NULL
              AND (r.created_by_user_id = :actorId OR EXISTS (
                SELECT 1 FROM training.routine_assignments a
                 WHERE a.routine_id = r.id AND a.cliente_user_id = :actorId AND a.estado = 'ACTIVE'
              ))`,
            { routineId: input.routineSessionId, actorId },
            transaction,
          );
          if (!accessibleRoutine.length) {
            throw new NotFoundException(
              "No encontramos esa sesión autorizada.",
            );
          }
          routineSnapshot = await this.captureRoutineSnapshot(
            input.routineSessionId!,
            transaction,
          );
        }

        const nextRevision = invite.current_revision + 1;
        const revisions = await this.select<RevisionRow>(
          `INSERT INTO training.training_invite_revisions
           (invite_id, revision, proposer_id, starts_at, time_zone, duration_minutes,
            place_kind, place_id, place_label, mode, routine_session_id, note, routine_snapshot)
         VALUES
           (:inviteId, :revision, :proposerId, :startsAt, :timeZone, :durationMinutes,
            :placeKind, :placeId, :placeLabel, :mode, :routineSessionId, :note, CAST(:routineSnapshot AS jsonb))
         RETURNING *`,
          {
            inviteId,
            revision: nextRevision,
            proposerId: actorId,
            startsAt: new Date(startsAt).toISOString(),
            timeZone: input.timeZone,
            durationMinutes: input.durationMinutes,
            placeKind: normalizedPlace.kind,
            placeId: normalizedPlace.placeId,
            placeLabel: normalizedPlace.label,
            mode: input.mode,
            routineSessionId: input.routineSessionId ?? null,
            note: input.note?.trim() || null,
            routineSnapshot: routineSnapshot
              ? JSON.stringify(routineSnapshot)
              : null,
          },
          transaction,
        );
        const updatedRows = await this.select<InviteRow>(
          `UPDATE training.training_invites
            SET current_revision = :nextRevision, updated_at = now()
          WHERE id = :inviteId AND state = 'PENDING'
            AND current_revision = :expectedRevision
          RETURNING id, inviter_id, recipient_id, state, current_revision,
                    created_at, updated_at`,
          {
            inviteId,
            expectedRevision: input.expectedRevision,
            nextRevision,
          },
          transaction,
        );
        if (!revisions[0] || !updatedRows[0]) {
          throw new ConflictException(
            "La invitación cambió; revisa su revisión actual.",
          );
        }
        await this.select(
          `INSERT INTO training.training_invite_commands
           (invite_id, actor_user_id, command_type, client_request_id,
            request_fingerprint, result_state, result_revision)
         VALUES (:inviteId, :actorId, 'COUNTERPROPOSE', :clientRequestId,
                 :requestFingerprint, 'PENDING', :revision)`,
          {
            inviteId,
            actorId,
            clientRequestId: input.clientRequestId,
            requestFingerprint: fingerprint,
            revision: nextRevision,
          },
          transaction,
        );
        return this.projectCurrentInvite(updatedRows[0], transaction);
      });
    } catch (error) {
      if (error instanceof UniqueConstraintError) {
        throw new ConflictException(
          "clientRequestId ya se usó con otra contrapropuesta.",
        );
      }
      throw error;
    }
  }

  private async insertResponseCommand(
    inviteId: string,
    actorId: string,
    input: RespondTrainingInviteInput,
    requestFingerprint: string,
    transaction: Transaction,
    resultState: "ACCEPTED" | "DECLINED" | "EXPIRED" = "ACCEPTED",
  ) {
    await this.select(
      `INSERT INTO training.training_invite_commands
         (invite_id, actor_user_id, command_type, client_request_id,
          request_fingerprint, result_state, result_revision)
       VALUES (:inviteId, :actorId, 'RESPOND', :clientRequestId,
               :requestFingerprint, :resultState, :revision)`,
      {
        inviteId,
        actorId,
        clientRequestId: input.clientRequestId,
        requestFingerprint,
        resultState,
        revision: input.expectedRevision,
      },
      transaction,
    );
  }

  private async ensureAcceptedMeetingAndChatEvent(
    invite: InviteRow,
    transaction: Transaction,
  ): Promise<void> {
    const revisions = await this.select<RevisionRow>(
      `SELECT * FROM training.training_invite_revisions
        WHERE invite_id = :inviteId AND revision = :revision`,
      { inviteId: invite.id, revision: invite.current_revision },
      transaction,
    );
    const revision = revisions[0];
    if (!revision || invite.state !== "ACCEPTED") {
      throw new ConflictException(
        "No se pudo materializar el encuentro aceptado.",
      );
    }

    if (revision.mode === "SHARED_SESSION" && revision.routine_session_id) {
      const snapshot =
        revision.routine_snapshot ??
        (await this.captureRoutineSnapshot(
          revision.routine_session_id,
          transaction,
        ));
      await this.sharedSessions.snapshotForAcceptedRevision(
        invite.id,
        revision.routine_session_id,
        invite.current_revision,
        snapshot,
        transaction,
      );
    }

    const conversationId =
      await this.chatRepository.ensureDirectConversationInTransaction(
        invite.inviter_id,
        invite.recipient_id,
        transaction,
      );
    const meetingId = randomUUID();
    await this.select(
      `INSERT INTO training.training_invite_meetings
         (id, invite_id, accepted_revision, starts_at, time_zone, place_label)
       VALUES (:id, :inviteId, :revision, :startsAt, :timeZone, :placeLabel)
       ON CONFLICT (invite_id) DO NOTHING
       RETURNING id`,
      {
        id: meetingId,
        inviteId: invite.id,
        revision: invite.current_revision,
        startsAt: revision.starts_at,
        timeZone: revision.time_zone,
        placeLabel: revision.place_label,
      },
      transaction,
    );
    const meetings = await this.select<{
      id: string;
      accepted_revision: number;
    }>(
      `SELECT id, accepted_revision FROM training.training_invite_meetings
        WHERE invite_id = :inviteId FOR UPDATE`,
      { inviteId: invite.id },
      transaction,
    );
    if (
      !meetings[0] ||
      meetings[0].accepted_revision !== invite.current_revision
    ) {
      throw new ConflictException("El encuentro ya existe con otra revisión.");
    }
    await this.select(
      `INSERT INTO chat.conversation_events
         (id, conversation_id, invitation_id, accepted_revision, starts_at, time_zone, place_label)
       VALUES (:id, :conversationId, :inviteId, :revision, :startsAt, :timeZone, :placeLabel)
       ON CONFLICT (invitation_id) DO NOTHING
       RETURNING id`,
      {
        id: randomUUID(),
        conversationId,
        inviteId: invite.id,
        revision: invite.current_revision,
        startsAt: revision.starts_at,
        timeZone: revision.time_zone,
        placeLabel: revision.place_label,
      },
      transaction,
    );
  }

  private async captureRoutineSnapshot(
    routineId: string,
    transaction: Transaction,
  ): Promise<
    Omit<SharedSessionSnapshot, "inviteId" | "routineId" | "revision">
  > {
    const rows = await this.select<{
      name: string;
      exercises: SharedSessionSnapshot["exercises"];
    }>(
      `SELECT r.nombre AS name,
              COALESCE(
                jsonb_agg(
                  jsonb_build_object(
                    'exerciseId', re.ejercicio_id,
                    'exerciseName', e.nombre,
                    'order', re.orden,
                    'targetSets', re.series_objetivo,
                    'repsMin', re.reps_min,
                    'repsMax', re.reps_max,
                    'restSeconds', re.descanso_seg
                  ) ORDER BY re.orden
                ) FILTER (WHERE re.id IS NOT NULL),
                '[]'::jsonb
              ) AS exercises
         FROM training.routines r
         LEFT JOIN training.routine_exercises re ON re.routine_id = r.id
         LEFT JOIN public.ejercicios e ON e.id = re.ejercicio_id
        WHERE r.id = :routineId AND r.estado = 'ACTIVE' AND r.hidden_at IS NULL
        GROUP BY r.id`,
      { routineId },
      transaction,
    );
    if (!rows[0])
      throw new NotFoundException("No encontramos esa rutina compartida.");
    return rows[0];
  }

  private async projectCurrentInvite(
    invite: InviteRow,
    transaction: Transaction,
  ) {
    const revisions = await this.select<RevisionRow>(
      `SELECT * FROM training.training_invite_revisions
        WHERE invite_id = :inviteId AND revision = :revision`,
      { inviteId: invite.id, revision: invite.current_revision },
      transaction,
    );
    if (!revisions[0]) {
      throw new ConflictException("La invitación no tiene revisión válida.");
    }
    return {
      ...this.project(invite, revisions[0]),
      response: invite.responded_at
        ? {
            decision:
              invite.state === "DECLINED"
                ? ("DECLINE" as const)
                : ("ACCEPT" as const),
            respondedBy: invite.responded_by_user_id,
            revision: invite.responded_revision,
            respondedAt: new Date(invite.responded_at).toISOString(),
          }
        : null,
    };
  }

  private async select<T extends object>(
    sql: string,
    replacements: Record<string, unknown>,
    transaction: Transaction,
  ): Promise<T[]> {
    return this.sequelize.query(sql, {
      type: QueryTypes.SELECT,
      replacements,
      transaction,
    }) as unknown as Promise<T[]>;
  }

  private fingerprint(value: Record<string, unknown>): string {
    return createHash("sha256").update(JSON.stringify(value)).digest("hex");
  }

  private project(invite: InviteRow, revision: RevisionRow) {
    return {
      id: invite.id,
      state: invite.state,
      currentRevision: invite.current_revision,
      revisions: [
        {
          revision: revision.revision,
          proposerId: revision.proposer_id,
          startsAt: new Date(revision.starts_at).toISOString(),
          timeZone: revision.time_zone,
          durationMinutes: revision.duration_minutes,
          place: {
            kind: revision.place_kind,
            ...(revision.place_id ? { placeId: revision.place_id } : {}),
            label: revision.place_label,
          },
          mode: revision.mode,
          ...(revision.routine_session_id
            ? { routineSessionId: revision.routine_session_id }
            : {}),
          ...(revision.note ? { note: revision.note } : {}),
          createdAt: new Date(revision.created_at).toISOString(),
        },
      ],
      participants: [invite.inviter_id, invite.recipient_id],
      createdAt: new Date(invite.created_at).toISOString(),
      updatedAt: new Date(invite.updated_at).toISOString(),
    };
  }
}
