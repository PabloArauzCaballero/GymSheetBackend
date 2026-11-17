import { Injectable } from "@nestjs/common";
import { QueryTypes, Transaction } from "sequelize";
import { Sequelize } from "sequelize-typescript";
import { LegalClientContext } from "./legal-client-context";
import { LegalDocumentVersion, PublishedLegalDocument } from "./legal-documents";

@Injectable()
export class LegalRepository {
  constructor(private readonly sequelize: Sequelize) {}

  runInTransaction<T>(work: (transaction: Transaction) => Promise<T>): Promise<T> {
    return this.sequelize.transaction(work);
  }

  /**
   * Documents of `documents` the user has not accepted, in one index-backed
   * query (unique key `user_id, document, version`). The guard calls this on
   * every authenticated request, so it must stay a single cheap statement.
   */
  findPending(userId: string, documents: readonly LegalDocumentVersion[]): Promise<LegalDocumentVersion[]> {
    return this.sequelize.query<LegalDocumentVersion>(
      `SELECT current_doc.document, current_doc.version
         FROM unnest(ARRAY[:documents]::varchar[], ARRAY[:versions]::varchar[])
              AS current_doc(document, version)
        WHERE NOT EXISTS (
          SELECT 1 FROM auth.terms_acceptances acceptance
           WHERE acceptance.user_id = :userId
             AND acceptance.document = current_doc.document
             AND acceptance.version = current_doc.version)`,
      {
        type: QueryTypes.SELECT,
        replacements: {
          userId,
          documents: documents.map((entry) => entry.document),
          versions: documents.map((entry) => entry.version),
        },
      },
    );
  }

  /** Idempotent: an acceptance already on record is kept with its original timestamp. */
  async insertAcceptances(
    userId: string,
    documents: readonly PublishedLegalDocument[],
    context: LegalClientContext,
    transaction: Transaction,
  ): Promise<void> {
    if (documents.length === 0) return;
    await this.sequelize.query(
      `INSERT INTO auth.terms_acceptances
         (user_id, document, version, content_sha256, channel, ip_hmac, user_agent)
       SELECT :userId, entry.document, entry.version, NULLIF(entry.content_sha256, ''), :channel, :ipHmac, :userAgent
         FROM unnest(ARRAY[:documents]::varchar[], ARRAY[:versions]::varchar[], ARRAY[:hashes]::varchar[])
              AS entry(document, version, content_sha256)
       ON CONFLICT (user_id, document, version) DO NOTHING`,
      {
        type: QueryTypes.INSERT,
        transaction,
        replacements: {
          userId,
          channel: context.channel,
          ipHmac: context.ipHmac,
          userAgent: context.userAgent,
          documents: documents.map((entry) => entry.document),
          versions: documents.map((entry) => entry.version),
          // Empty string stands for "no hash": Sequelize cannot bind null inside an array literal.
          hashes: documents.map((entry) => entry.contentSha256 ?? ""),
        },
      },
    );
  }

  /** Keeps the legacy `usuarios.accepted_terms_at`/`terms_version` columns in step. */
  async touchLegacyTermsColumns(userId: string, version: string, transaction: Transaction): Promise<void> {
    await this.sequelize.query(
      `UPDATE public.usuarios SET accepted_terms_at = now(), terms_version = :version WHERE id = :userId`,
      { type: QueryTypes.UPDATE, transaction, replacements: { userId, version } },
    );
  }
}
