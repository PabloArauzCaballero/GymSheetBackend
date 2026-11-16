import { HttpStatus, Injectable } from "@nestjs/common";
import { Transaction } from "sequelize";
import { DomainException } from "../../common/errors/domain.exception";
import { LegalClientContext } from "./legal-client-context";
import { LEGAL_DOCUMENTS, LegalDocumentVersion, currentLegalDocuments } from "./legal-documents";
import { LegalRepository } from "./legal.repository";
import { AcceptLegalDocumentsInput } from "./legal.schemas";

const OUTDATED_MESSAGE =
  "Los términos o la política de privacidad cambiaron. Vuelve a leerlos y acéptalos para continuar.";

@Injectable()
export class LegalService {
  constructor(private readonly repository: LegalRepository) {}

  currentDocuments(): { documents: LegalDocumentVersion[] } {
    return { documents: currentLegalDocuments() };
  }

  async pending(userId: string): Promise<{ pending: LegalDocumentVersion[] }> {
    return { pending: await this.repository.findPending(userId, currentLegalDocuments()) };
  }

  async hasPending(userId: string): Promise<boolean> {
    return (await this.repository.findPending(userId, currentLegalDocuments())).length > 0;
  }

  /** Signup sends the version it showed; an older one means the person read outdated text. */
  assertCurrentTermsVersion(version: string): void {
    if (version !== LEGAL_DOCUMENTS.TERMS) throw this.outdated();
  }

  /** Records acceptance of every current document inside the signup transaction. */
  async recordSignupAcceptances(
    userId: string,
    context: LegalClientContext,
    transaction: Transaction,
  ): Promise<void> {
    await this.repository.insertAcceptances(userId, currentLegalDocuments(), context, transaction);
  }

  /** Accepts current versions only. Re-accepting is a no-op, so retries are safe. */
  async accept(
    userId: string,
    input: AcceptLegalDocumentsInput,
    context: LegalClientContext,
  ): Promise<{ pending: LegalDocumentVersion[] }> {
    if (input.acceptances.some(({ document, version }) => LEGAL_DOCUMENTS[document] !== version)) {
      throw this.outdated();
    }
    await this.repository.runInTransaction(async (transaction) => {
      await this.repository.insertAcceptances(userId, input.acceptances, context, transaction);
      if (input.acceptances.some(({ document }) => document === "TERMS")) {
        await this.repository.touchLegacyTermsColumns(userId, LEGAL_DOCUMENTS.TERMS, transaction);
      }
    });
    return this.pending(userId);
  }

  private outdated(): DomainException {
    return new DomainException(HttpStatus.CONFLICT, "TERMS_VERSION_OUTDATED", OUTDATED_MESSAGE, {
      documents: currentLegalDocuments(),
    });
  }
}
