import { Injectable } from "@nestjs/common";
import { QueryTypes, Transaction } from "sequelize";
import { Sequelize } from "sequelize-typescript";
import { IdentityProvider } from "./oidc-token-verifier";

/** Data access for `auth.identities` (provider subject → account). */
@Injectable()
export class IdentityRepository {
  constructor(private readonly sequelize: Sequelize) {}

  async findUserId(provider: IdentityProvider, subject: string): Promise<string | null> {
    const [row] = await this.sequelize.query<{ userId: string }>(
      `SELECT user_id AS "userId" FROM auth.identities WHERE provider = :provider AND subject = :subject`,
      { type: QueryTypes.SELECT, replacements: { provider, subject } },
    );
    return row?.userId ?? null;
  }

  /** Raises `UniqueConstraintError` when the subject is already linked; callers map it to 409. */
  async link(
    provider: IdentityProvider,
    subject: string,
    userId: string,
    email: string | null,
    transaction: Transaction,
  ): Promise<void> {
    await this.sequelize.query(
      `INSERT INTO auth.identities (provider, subject, user_id, email)
       VALUES (:provider, :subject, :userId, :email)`,
      { type: QueryTypes.INSERT, replacements: { provider, subject, userId, email }, transaction },
    );
  }
}
