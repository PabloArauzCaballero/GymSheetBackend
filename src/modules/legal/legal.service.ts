import { HttpStatus, Injectable } from "@nestjs/common";
import { Transaction } from "sequelize";
import { DomainException } from "../../common/errors/domain.exception";
import { AccountKind } from "../../common/types/auth-context.types";
import { LegalClientContext } from "./legal-client-context";
import { currentConsentVersions } from "./consent-versions";
import {
  LEGAL_DOCUMENTS,
  LEGAL_DOCUMENT_SETS,
  LegalDocumentVersion,
  PublishedLegalDocument,
  currentLegalDocuments,
} from "./legal-documents";
import { LegalRepository } from "./legal.repository";
import { AcceptLegalDocumentsInput, SignupAcceptance } from "./legal.schemas";

const OUTDATED_MESSAGE =
  "Los términos, la política de privacidad o las normas de la comunidad cambiaron. Vuelve a leerlos y acéptalos para continuar.";

@Injectable()
export class LegalService {
  constructor(private readonly repository: LegalRepository) {}

  /** Documents of an account kind with the hash of their text, and the version of each separate consent. */
  currentDocuments(kind: AccountKind = "PERSON"): {
    documents: PublishedLegalDocument[];
    consents: ReturnType<typeof currentConsentVersions>;
  } {
    return { documents: currentLegalDocuments(kind), consents: currentConsentVersions() };
  }

  async pending(userId: string, kind: AccountKind = "PERSON"): Promise<{ pending: LegalDocumentVersion[] }> {
    return { pending: await this.repository.findPending(userId, currentLegalDocuments(kind)) };
  }

  async hasPending(userId: string, kind: AccountKind = "PERSON"): Promise<boolean> {
    return (await this.repository.findPending(userId, currentLegalDocuments(kind))).length > 0;
  }

  /** Signup sends the version it showed; an older one means the person read outdated text. */
  assertCurrentTermsVersion(version: string): void {
    if (version !== LEGAL_DOCUMENTS.TERMS) throw this.outdated("PERSON");
  }

  /**
   * A business signup lists every document of its set with the version (and,
   * when sent, the hash) the client showed. Anything missing or stale is the
   * same answer as an outdated person signup: 409 with the current set.
   */
  assertCurrentAcceptances(kind: AccountKind, acceptances: readonly SignupAcceptance[]): void {
    const current = currentLegalDocuments(kind);
    const matches = current.every((published) =>
      acceptances.some(
        (sent) =>
          sent.document === published.document &&
          sent.version === published.version &&
          (sent.contentSha256 === undefined || sent.contentSha256 === published.contentSha256),
      ),
    );
    if (!matches) throw this.outdated(kind);
  }

  /** Records acceptance of every current document of the kind inside the signup transaction. */
  async recordSignupAcceptances(
    userId: string,
    context: LegalClientContext,
    transaction: Transaction,
    kind: AccountKind = "PERSON",
  ): Promise<void> {
    await this.repository.insertAcceptances(userId, currentLegalDocuments(kind), context, transaction);
  }

  /** Accepts current versions of the account's own set only. Re-accepting is a no-op, so retries are safe. */
  async accept(
    userId: string,
    input: AcceptLegalDocumentsInput,
    context: LegalClientContext,
    kind: AccountKind = "PERSON",
  ): Promise<{ pending: LegalDocumentVersion[] }> {
    const applicable = new Set(LEGAL_DOCUMENT_SETS[kind]);
    if (input.acceptances.some(({ document }) => !applicable.has(document))) {
      throw new DomainException(
        HttpStatus.UNPROCESSABLE_ENTITY,
        "LEGAL_DOCUMENT_NOT_APPLICABLE",
        "Ese documento no aplica a este tipo de cuenta.",
        { documents: currentLegalDocuments(kind) },
      );
    }
    if (input.acceptances.some(({ document, version }) => LEGAL_DOCUMENTS[document] !== version)) {
      throw this.outdated(kind);
    }
    const accepted = new Set(input.acceptances.map(({ document }) => document));
    // Versions match the catalog here, so the catalog entry carries the accepted text hash.
    const published = currentLegalDocuments(kind).filter(({ document }) => accepted.has(document));
    await this.repository.runInTransaction(async (transaction) => {
      await this.repository.insertAcceptances(userId, published, context, transaction);
      if (input.acceptances.some(({ document }) => document === "TERMS")) {
        await this.repository.touchLegacyTermsColumns(userId, LEGAL_DOCUMENTS.TERMS, transaction);
      }
    });
    return this.pending(userId, kind);
  }

  private outdated(kind: AccountKind): DomainException {
    return new DomainException(HttpStatus.CONFLICT, "TERMS_VERSION_OUTDATED", OUTDATED_MESSAGE, {
      documents: currentLegalDocuments(kind),
    });
  }
}
