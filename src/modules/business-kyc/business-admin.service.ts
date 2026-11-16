import { HttpStatus, Injectable, NotFoundException } from "@nestjs/common";
import { QueryTypes, Transaction, UniqueConstraintError } from "sequelize";
import { Sequelize } from "sequelize-typescript";
import { DomainException } from "../../common/errors/domain.exception";
import { AuthenticatedUser } from "../../common/types/auth-context.types";
import { RETIRED_LOCK_DAYS, addDays, parseHandle } from "../business-accounts/handle-rules";
import { HandlesRepository } from "../business-accounts/handles.repository";
import { KycCipher, assertKycAvailable, kycFingerprint } from "./kyc-cipher";
import { ciFingerprintValue, normalizeBolivianMobile, normalizeNit, parseCi } from "./kyc-formats";
import { KycEffectsRepository } from "./kyc-effects.repository";
import { KycNotices } from "./kyc-notices";
import { KycReviewRepository } from "./kyc-review.repository";
import { assertNotOwnBusiness } from "./kyc-review.service";
import { assertKycTransition } from "./kyc-state-machine";
import { KycStatus } from "./kyc.catalog";
import { KycRepository } from "./kyc.repository";
import type { AccountActionInput, AccountsQuery, BannedTermsInput, BlocklistEntryInput } from "./kyc.schemas";

function invalidHandle(): DomainException {
  return new DomainException(HttpStatus.UNPROCESSABLE_ENTITY, "HANDLE_INVALID", "Ese @usuario no tiene un formato válido.");
}

/**
 * REPP operating business accounts (plan §3.3): suspension and reinstatement,
 * protected handles and forced renames, the identity blocklist and the banned
 * terms. Every mutation is audited by its controller.
 */
@Injectable()
export class BusinessAdminService {
  constructor(
    private readonly sequelize: Sequelize,
    private readonly repository: KycRepository,
    private readonly review: KycReviewRepository,
    private readonly effects: KycEffectsRepository,
    private readonly handles: HandlesRepository,
    private readonly notices: KycNotices,
    private readonly cipher: KycCipher,
  ) {}

  async listAccounts(query: AccountsQuery) {
    const after = decodeAccountCursor(query.cursor);
    const rows = await this.review.listAccounts({ ...query, after, limit: query.limit + 1 });
    const page = rows.slice(0, query.limit);
    const last = page[page.length - 1];
    return {
      items: page.map((row) => ({ ...row, createdAt: new Date(row.createdAt).toISOString() })),
      nextCursor: rows.length > query.limit && last ? Buffer.from(`${new Date(last.createdAt).toISOString()}|${last.accountId}`).toString("base64url") : null,
    };
  }

  /** The current (approved) attempt goes SUSPENDED; the listing stops being public. */
  async suspend(actor: AuthenticatedUser, accountId: string, input: AccountActionInput): Promise<{ status: "SUSPENDED" }> {
    await this.sequelize.transaction(async (transaction) => {
      const { account, submission, entity } = await this.loadAccount(actor, accountId, transaction);
      assertKycTransition(submission.status, "SUSPENDED");
      const decisionId = await this.record(account.userId, submission.id, submission.status, "SUSPENDED", "SUSPEND", actor, input, transaction);
      const now = new Date();
      await this.effects.setEntityStatus(entity, "SUSPENDED", entity.isVerified, transaction);
      await this.effects.updateAccount(
        account.userId,
        { status: "SUSPENDED", kyc_status: "SUSPENDED", suspension_reason_code: input.reasonCode, suspended_at: now },
        {},
        transaction,
      );
      await this.notices.send(account.userId, decisionId, { kind: "SUSPENDED", reason: input.reasonCode }, transaction);
    });
    return { status: "SUSPENDED" };
  }

  /** SUSPENDED → APPROVED: a human looked at it, so it comes back «Verificado por REPP». */
  async reinstate(actor: AuthenticatedUser, accountId: string, input: AccountActionInput): Promise<{ status: "ACTIVE" }> {
    await this.sequelize.transaction(async (transaction) => {
      const { account, submission, entity } = await this.loadAccount(actor, accountId, transaction);
      assertKycTransition(submission.status, "APPROVED");
      if (submission.status !== "SUSPENDED") throw new DomainException(HttpStatus.CONFLICT, "KYC_INVALID_TRANSITION", "El negocio no está suspendido.");
      const decisionId = await this.record(account.userId, submission.id, "SUSPENDED", "APPROVED", "REINSTATE", actor, input, transaction);
      await this.effects.publish(entity, true, transaction);
      await this.effects.updateAccount(
        account.userId,
        { status: "ACTIVE", kyc_status: "APPROVED", suspension_reason_code: null, suspended_at: null },
        { humanVerification: true },
        transaction,
      );
      await this.notices.send(account.userId, decisionId, { kind: "REINSTATED" }, transaction);
    });
    return { status: "ACTIVE" };
  }

  private async loadAccount(actor: AuthenticatedUser, accountId: string, transaction: Transaction) {
    const account = await this.effects.findAccount(accountId, transaction, true);
    if (!account) throw new NotFoundException("Negocio no encontrado.");
    assertNotOwnBusiness(actor, account);
    const submission = account.currentSubmissionId ? await this.repository.findSubmission(account.currentSubmissionId, transaction, true) : null;
    if (!submission) throw new DomainException(HttpStatus.CONFLICT, "KYC_INVALID_TRANSITION", "El negocio todavía no fue aprobado.");
    const entity = await this.effects.findEntity(account.entityId, transaction);
    if (!entity) throw new NotFoundException("Negocio no encontrado.");
    return { account, submission, entity };
  }

  private async record(
    accountId: string,
    submissionId: string,
    from: KycStatus,
    to: "SUSPENDED" | "APPROVED",
    decision: "SUSPEND" | "REINSTATE",
    actor: AuthenticatedUser,
    input: AccountActionInput,
    transaction: Transaction,
  ): Promise<string> {
    const decisionId = await this.repository.insertDecision(
      { submissionId, decision, actorUserId: actor.id, reasonCodes: [input.reasonCode], note: input.note ?? null, allowResubmit: null },
      transaction,
    );
    await this.repository.updateSubmission(submissionId, { status: to, decided_at: new Date() }, transaction);
    await this.repository.insertHistory({ accountId, submissionId, from, to, decisionId, actorUserId: actor.id }, transaction);
    return decisionId;
  }

  /** A protected brand: nobody can claim it, or a look-alike of it. 409 while someone holds it. */
  async reserveHandle(input: { handle: string; reason: string }): Promise<{ handle: string; status: "RESERVED" }> {
    const parsed = parseHandle(input.handle);
    if ("rejection" in parsed) {
      if (parsed.rejection === "INVALID") throw invalidHandle();
      // A word reserved in code is already protected for everyone.
      throw new DomainException(HttpStatus.CONFLICT, "HANDLE_NOT_RESERVABLE", "Ese nombre ya está reservado por el sistema.");
    }
    return this.sequelize.transaction(async (transaction) => {
      await this.handles.lockSkeleton(parsed.skeleton, transaction);
      if ((await this.handles.findHolders(parsed.skeleton, null, new Date(), transaction)).length > 0) {
        throw new DomainException(HttpStatus.CONFLICT, "HANDLE_TAKEN", "Ese nombre ya está en uso o reservado.");
      }
      await this.insertReservation(parsed.handle, parsed.skeleton, input.reason, transaction);
      return { handle: parsed.handle, status: "RESERVED" as const };
    });
  }

  private async insertReservation(handle: string, skeleton: string, reason: string, transaction: Transaction): Promise<void> {
    try {
      await this.sequelize.query(
        `INSERT INTO directory.handles (handle, skeleton, owner_entity_id, status, reserved_reason) VALUES (:handle, :skeleton, NULL, 'RESERVED', :reason)`,
        { replacements: { handle, skeleton, reason }, transaction },
      );
    } catch (error: unknown) {
      if (error instanceof UniqueConstraintError) throw new DomainException(HttpStatus.CONFLICT, "HANDLE_TAKEN", "Ese nombre ya está en uso o reservado.");
      throw error;
    }
  }

  async removeReservation(handle: string): Promise<void> {
    const [rows] = await this.sequelize.query(`DELETE FROM directory.handles WHERE handle = :handle AND status = 'RESERVED' RETURNING handle`, {
      replacements: { handle: handle.trim().replace(/^@/u, "").toLowerCase() },
    });
    if (rows.length === 0) throw new NotFoundException("Reserva no encontrada.");
  }

  /**
   * Impersonation: REPP renames a listing's handle without the rename limits.
   * The old handle retires WITHOUT redirect (it must not keep sending people
   * to the impersonator) and stays locked, so REPP can then reserve it.
   */
  async forceRename(actor: AuthenticatedUser, current: string, input: { newHandle: string; reason: string }): Promise<{ handle: string; previous: string }> {
    const from = parseHandle(current);
    const to = parseHandle(input.newHandle);
    if ("rejection" in from) throw new NotFoundException("Negocio no encontrado.");
    if ("rejection" in to) throw invalidHandle();
    return this.sequelize.transaction(async (transaction) => {
      const row = await this.handles.findByHandle(from.handle, transaction);
      if (!row?.ownerEntityId || (row.status !== "ACTIVE" && row.status !== "PENDING")) throw new NotFoundException("Negocio no encontrado.");
      // Same rule as every other REPP action: never on the operator's own business.
      const owner = await this.effects.findAccountByEntity(row.ownerEntityId, transaction);
      if (owner) assertNotOwnBusiness(actor, owner);
      const now = new Date();
      await this.handles.lockSkeleton(to.skeleton, transaction);
      if ((await this.handles.findHolders(to.skeleton, row.ownerEntityId, now, transaction)).length > 0) {
        throw new DomainException(HttpStatus.CONFLICT, "HANDLE_TAKEN", "Ese nombre ya está en uso o reservado.");
      }
      await this.sequelize.query(
        `UPDATE directory.handles SET status = 'RETIRED', redirect_to_handle = NULL, redirect_until = NULL, locked_until = :lockedUntil, updated_at = now()
          WHERE handle = :handle`,
        { replacements: { handle: from.handle, lockedUntil: addDays(now, RETIRED_LOCK_DAYS) }, transaction },
      );
      await this.handles.insert({ handle: to.handle, skeleton: to.skeleton, ownerEntityId: row.ownerEntityId, status: row.status }, transaction);
      await this.handles.recordChange(
        { entityId: row.ownerEntityId, from: from.handle, to: to.handle, actorUserId: actor.id, reason: "REPP_FORCED" },
        transaction,
      );
      return { handle: to.handle, previous: from.handle };
    });
  }

  async listBlocklist() {
    const rows = await this.sequelize.query<{ id: string; kind: string; reasonCode: string; createdAt: Date; expiresAt: Date | null }>(
      `SELECT id, kind, reason_code AS "reasonCode", created_at AS "createdAt", expires_at AS "expiresAt"
         FROM business.blocklist WHERE removed_at IS NULL ORDER BY created_at DESC LIMIT 500`,
      { type: QueryTypes.SELECT },
    );
    return rows.map((row) => ({ ...row, createdAt: new Date(row.createdAt).toISOString(), expiresAt: row.expiresAt ? new Date(row.expiresAt).toISOString() : null }));
  }

  /** Only the HMAC of the value is stored; the value itself is never kept or returned. */
  async addBlocklist(actor: AuthenticatedUser, input: BlocklistEntryInput): Promise<{ id: string; kind: string }> {
    assertKycAvailable(this.cipher);
    const normalized = normalizeIdentity(input.kind, input.value);
    if (!normalized) throw new DomainException(HttpStatus.UNPROCESSABLE_ENTITY, "KYC_FIELD_INVALID", "Ese valor no tiene un formato válido.", { field: "value", reason: "FORMAT" });
    try {
      const [row] = await this.sequelize.query<{ id: string }>(
        `INSERT INTO business.blocklist (kind, hmac, reason_code, created_by_user_id, expires_at)
         VALUES (:kind, :hmac, :reasonCode, :actorId, :expiresAt) RETURNING id`,
        {
          type: QueryTypes.SELECT,
          replacements: { kind: input.kind, hmac: kycFingerprint(input.kind, normalized), reasonCode: input.reasonCode, actorId: actor.id, expiresAt: input.expiresAt ?? null },
        },
      );
      return { id: row.id, kind: input.kind };
    } catch (error: unknown) {
      if (error instanceof UniqueConstraintError) throw new DomainException(HttpStatus.CONFLICT, "BLOCKLIST_ENTRY_EXISTS", "Ese dato ya está en la lista.");
      throw error;
    }
  }

  async removeBlocklist(actor: AuthenticatedUser, id: string): Promise<void> {
    const [rows] = await this.sequelize.query(
      `UPDATE business.blocklist SET removed_at = now(), removed_by_user_id = :actorId WHERE id = :id AND removed_at IS NULL RETURNING id`,
      { replacements: { id, actorId: actor.id } },
    );
    if (rows.length === 0) throw new NotFoundException("Entrada no encontrada.");
  }

  async listBannedTerms() {
    return {
      terms: await this.sequelize.query<{ term: string; scope: string }>(`SELECT term, scope FROM business.banned_terms ORDER BY term`, {
        type: QueryTypes.SELECT,
      }),
    };
  }

  /** Replaces the whole list in one transaction. */
  async replaceBannedTerms(actor: AuthenticatedUser, input: BannedTermsInput) {
    const unique = new Map(input.terms.map((entry) => [entry.term, entry.scope]));
    await this.sequelize.transaction(async (transaction) => {
      await this.sequelize.query("DELETE FROM business.banned_terms", { transaction });
      for (const [term, scope] of unique) {
        await this.sequelize.query(
          `INSERT INTO business.banned_terms (term, scope, created_by_user_id) VALUES (:term, :scope, :actorId)`,
          { replacements: { term, scope, actorId: actor.id }, transaction },
        );
      }
    });
    return this.listBannedTerms();
  }
}

/** The same normalization the KYC applies before hashing, so a blocked datum matches its fingerprint. */
function normalizeIdentity(kind: BlocklistEntryInput["kind"], value: string): string | null {
  if (kind === "NIT") return normalizeNit(value);
  if (kind === "PHONE") return normalizeBolivianMobile(value);
  if (kind === "EMAIL") return value.includes("@") ? value : null;
  // A CI entry blocks the number, whatever complement it is written with (see `ciFingerprintValue`).
  const [number, complement] = value.split("-");
  const ci = parseCi(number ?? "", complement ?? null, null);
  return ci ? ciFingerprintValue(ci) : null;
}

function decodeAccountCursor(cursor: string | undefined): { createdAt: Date; id: string } | null {
  if (!cursor) return null;
  const [at, id] = Buffer.from(cursor, "base64url").toString("utf8").split("|");
  const createdAt = new Date(at ?? "");
  return Number.isNaN(createdAt.getTime()) || !/^[0-9a-f-]{36}$/u.test(id ?? "") ? null : { createdAt, id };
}
