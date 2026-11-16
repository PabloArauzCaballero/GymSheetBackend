import { Injectable } from "@nestjs/common";
import { InjectModel } from "@nestjs/sequelize";
import { Op, QueryTypes, Transaction } from "sequelize";
import { SignupTicketKind, SignupTicketModel } from "./signup-ticket.model";

/** Data access of the spent single-use token ledger (`auth.signup_tickets`). */
@Injectable()
export class TicketLedgerRepository {
  constructor(
    @InjectModel(SignupTicketModel)
    private readonly tickets: typeof SignupTicketModel,
  ) {}

  async isSpent(id: string): Promise<boolean> {
    return (await this.tickets.count({ where: { id } })) > 0;
  }

  /**
   * Marks a token as used. Returns false when it already was: the primary key
   * turns two concurrent spends of the same token into one winner.
   */
  async spend(
    id: string,
    kind: SignupTicketKind,
    issuedAt: Date,
    usedAt: Date,
    transaction?: Transaction,
  ): Promise<boolean> {
    const rows = await this.tickets.sequelize!.query<{ id: string }>(
      `INSERT INTO auth.signup_tickets (id, kind, issued_at, used_at)
       VALUES (:id, :kind, :issuedAt, :usedAt)
       ON CONFLICT (id) DO NOTHING
       RETURNING id`,
      { type: QueryTypes.SELECT, replacements: { id, kind, issuedAt, usedAt }, transaction },
    );
    return rows.length === 1;
  }

  /** Removes ledger rows used before `cutoff`; their tokens are long expired by then. */
  deleteUsedBefore(cutoff: Date): Promise<number> {
    return this.tickets.destroy({ where: { usedAt: { [Op.lt]: cutoff } } });
  }
}
