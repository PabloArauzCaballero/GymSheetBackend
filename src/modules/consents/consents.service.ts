import { HttpStatus, Injectable } from "@nestjs/common";
import { Transaction } from "sequelize";
import { DomainException } from "../../common/errors/domain.exception";
import { CONSENT_VERSIONS, ConsentKind, PERSON_CONSENT_KINDS } from "../legal/consent-versions";
import type { LegalChannel } from "../legal/legal-client-context";
import { MediaReleaseService } from "../media/media-release.service";
import { ConsentResponse, mapConsent, mapConsents } from "./consents.mapper";
import { ConsentsRepository } from "./consents.repository";
import type { SetConsentInput } from "./consents.schemas";

const REQUIRED_MESSAGES: Record<ConsentKind, string> = {
  HEALTH: "Para guardar información de salud primero tienes que dar tu consentimiento de salud.",
  ORIENTATION: "Para guardar tu orientación primero tienes que dar tu consentimiento para ese dato.",
  VERIFICATION_SELFIE: "Para verificar tu perfil primero tienes que dar tu consentimiento para la selfie.",
  PRECISE_LOCATION: "Para compartir tu ubicación en el mapa primero tienes que dar tu consentimiento de ubicación.",
  KYC_SELFIE: "Para tomar la selfie de verificación del negocio primero tienes que dar tu consentimiento para la selfie.",
};

/**
 * Ledger of separate, revocable consents (ADR-0014). Granting records the
 * text version and the channel; revoking closes the grant AND erases the
 * datum it covered, in one transaction; stored files it covered (selfies)
 * are queued on the shared `media.release` outbox in that same transaction.
 * The other modules call `assertGranted` inside the transaction of the write
 * that needs consent.
 */
@Injectable()
export class ConsentsService {
  constructor(
    private readonly repository: ConsentsRepository,
    private readonly mediaRelease: MediaReleaseService,
  ) {}

  async list(userId: string, kinds: readonly ConsentKind[] = PERSON_CONSENT_KINDS): Promise<{ consents: ConsentResponse[] }> {
    return { consents: mapConsents(await this.repository.latestPerKind(userId), kinds) };
  }

  async set(
    userId: string,
    kind: ConsentKind,
    input: SetConsentInput,
    channel: LegalChannel,
  ): Promise<ConsentResponse> {
    await this.repository.runInTransaction((transaction) =>
      input.granted
        ? this.grant(userId, kind, input.version ?? "", channel, transaction)
        : this.revoke(userId, kind, transaction),
    );
    const rows = await this.repository.latestPerKind(userId);
    return mapConsent(kind, rows.find((row) => row.kind === kind));
  }

  /** Idempotent for the same version; a newer version replaces the open grant. */
  async grant(
    userId: string,
    kind: ConsentKind,
    version: string,
    channel: LegalChannel,
    transaction: Transaction,
  ): Promise<void> {
    if (version !== CONSENT_VERSIONS[kind]) {
      throw new DomainException(
        HttpStatus.CONFLICT,
        "CONSENT_VERSION_OUTDATED",
        "El texto de este consentimiento cambió. Vuelve a leerlo para aceptarlo.",
        { kind, currentVersion: CONSENT_VERSIONS[kind] },
      );
    }
    const open = await this.repository.findOpen(userId, kind, transaction, "UPDATE");
    if (open?.version === version) return;
    if (open) await this.repository.close(userId, kind, transaction);
    await this.repository.open(userId, kind, version, channel, transaction);
  }

  /** Erases the datum even when nothing was open, so a retry always leaves it erased. */
  async revoke(userId: string, kind: ConsentKind, transaction: Transaction): Promise<void> {
    await this.repository.findOpen(userId, kind, transaction, "UPDATE");
    await this.repository.close(userId, kind, transaction);
    const erasedFiles = await this.repository.eraseData(userId, kind, transaction);
    for (const file of erasedFiles) await this.mediaRelease.requestRelease(file, transaction);
  }

  /** 400 CONSENT_REQUIRED without an open consent; holds a share lock until `transaction` ends. */
  async assertGranted(userId: string, kind: ConsentKind, transaction: Transaction): Promise<void> {
    if (await this.repository.findOpen(userId, kind, transaction, "SHARE")) return;
    throw consentRequired(kind);
  }

  /**
   * Stricter than `assertGranted`: the open grant must be of the CURRENT text
   * (biometric data is processed only under the text in force). With
   * `transaction` it holds the same share lock; without one it is a plain read,
   * for a cheap check before expensive work that a locked check repeats.
   */
  async assertCurrentGranted(userId: string, kind: ConsentKind, transaction?: Transaction): Promise<void> {
    const open = transaction
      ? await this.repository.findOpen(userId, kind, transaction, "SHARE")
      : (await this.repository.latestPerKind(userId)).find((row) => row.kind === kind && row.revokedAt === null);
    if (open?.version === CONSENT_VERSIONS[kind]) return;
    throw consentRequired(kind);
  }
}

function consentRequired(kind: ConsentKind): DomainException {
  return new DomainException(HttpStatus.BAD_REQUEST, "CONSENT_REQUIRED", REQUIRED_MESSAGES[kind], { kind });
}
