import { Inject, Injectable, Logger } from "@nestjs/common";
import { QueryTypes } from "sequelize";
import { Sequelize } from "sequelize-typescript";
import { MEDIA_STORAGE_PROVIDER, MediaStorageProvider } from "../media/media-storage.port";
import { KycCipher } from "./kyc-cipher";

type SubmissionRow = {
  id: string;
  version: number;
  status: string;
  legalKind: "COMPANY" | "INDIVIDUAL";
  nitMasked: string | null;
  nitEnc: Buffer | null;
  repCiMasked: string | null;
  repCiEnc: Buffer | null;
  phoneMasked: string | null;
  phoneEnc: Buffer | null;
};
type DocumentRow = { id: string; submissionId: string; kind: string; mime: string; sha256: string; storageKey: string; legalKind: string };

/** Why a document travels without its bytes. */
export type WithheldReason = "REPRESENTATIVE_IDENTITY" | "UNREADABLE";

export type BusinessKycExport = {
  submissions: { id: string; version: number; status: string; legalKind: string; nit: string | null; repCiNumber: string | null; phone: string | null }[];
  documents: { id: string; submissionId: string; kind: string; mime: string; sha256: string; contentBase64: string | null; withheld: WithheldReason | null }[];
};

/**
 * The business's own KYC for its export (plan §2.14, ADR-0028). The NIT is
 * the company's and goes in clear. CI and phone are the owner's own only for
 * an INDIVIDUAL (a coach): then they go in clear and the CI and selfie images
 * decrypted; for a COMPANY they belong to its representative, another person,
 * so only the masks travel and those images are withheld. A registration
 * document (SEPREC) is the company's and always travels.
 */
@Injectable()
export class KycExportReader {
  private readonly logger = new Logger(KycExportReader.name);

  constructor(
    private readonly sequelize: Sequelize,
    private readonly cipher: KycCipher,
    @Inject(MEDIA_STORAGE_PROVIDER) private readonly storage: MediaStorageProvider,
  ) {}

  /** Null for an account that is not a business. */
  async read(userId: string): Promise<BusinessKycExport | null> {
    const [account] = await this.sequelize.query<{ userId: string }>(`SELECT user_id AS "userId" FROM business.accounts WHERE user_id = :userId`, {
      type: QueryTypes.SELECT,
      replacements: { userId },
    });
    if (!account) return null;
    const submissions = await this.sequelize.query<SubmissionRow>(
      `SELECT id, version, status, legal_kind AS "legalKind", nit_masked AS "nitMasked", nit_enc AS "nitEnc", rep_ci_masked AS "repCiMasked",
              rep_ci_enc AS "repCiEnc", phone_masked AS "phoneMasked", phone_enc AS "phoneEnc"
         FROM business.kyc_submissions WHERE account_id = :userId ORDER BY version`,
      { type: QueryTypes.SELECT, replacements: { userId } },
    );
    const documents = await this.sequelize.query<DocumentRow>(
      `SELECT d.id, d.submission_id AS "submissionId", d.kind, d.mime, d.sha256, d.storage_key AS "storageKey", s.legal_kind AS "legalKind"
         FROM business.kyc_documents d JOIN business.kyc_submissions s ON s.id = d.submission_id
        WHERE s.account_id = :userId AND d.deleted_at IS NULL ORDER BY s.version, d.uploaded_at`,
      { type: QueryTypes.SELECT, replacements: { userId } },
    );
    return {
      submissions: submissions.map((row) => {
        const own = row.legalKind === "INDIVIDUAL";
        return {
          id: row.id,
          version: row.version,
          status: row.status,
          legalKind: row.legalKind,
          nit: this.clear(row.nitEnc) ?? row.nitMasked,
          repCiNumber: own ? (this.clear(row.repCiEnc) ?? row.repCiMasked) : row.repCiMasked,
          phone: own ? (this.clear(row.phoneEnc) ?? row.phoneMasked) : row.phoneMasked,
        };
      }),
      documents: await Promise.all(documents.map((row) => this.document(row))),
    };
  }

  private clear(value: Buffer | null): string | null {
    if (!value) return null;
    // Without the key (or with a damaged value) the mask travels instead.
    try {
      return this.cipher.decryptText(value);
    } catch {
      return null;
    }
  }

  private async document(row: DocumentRow): Promise<BusinessKycExport["documents"][number]> {
    const base = { id: row.id, submissionId: row.submissionId, kind: row.kind, mime: row.mime, sha256: row.sha256 };
    if (row.legalKind !== "INDIVIDUAL" && row.kind !== "SEPREC") return { ...base, contentBase64: null, withheld: "REPRESENTATIVE_IDENTITY" };
    try {
      const bytes = this.cipher.decrypt(await this.storage.download(row.storageKey));
      return { ...base, contentBase64: bytes.toString("base64"), withheld: null };
    } catch (error: unknown) {
      // A missing key or file is not the export's failure: the document is listed as unreadable.
      this.logger.warn({ event: "account_export.kyc_document_unreadable", documentId: row.id, errorName: error instanceof Error ? error.name : "UnknownError" });
      return { ...base, contentBase64: null, withheld: "UNREADABLE" };
    }
  }
}
