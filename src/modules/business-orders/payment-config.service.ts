import { HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
import { Transaction } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import { DomainException } from '../../common/errors/domain.exception';
import { AuthenticatedUser } from '../../common/types/auth-context.types';
import { BusinessAccountRow, BusinessAccountsRepository } from '../business-accounts/business-accounts.repository';
import { EntityPaymentConfigModel } from '../directory/models/entity-payment-config.model';
import { MediaReleaseService } from '../media/media-release.service';
import { UploadedSelfie } from '../verification/selfie-image';
import { PaymentConfigInput } from './business-orders.schemas';
import { PaymentEvidenceStore } from './payment-evidence.store';
import { SellersRepository } from './sellers.repository';

/** Similarity at or above which the account holder is taken as the business itself (plan §2.9). */
export const HOLDER_MATCH_THRESHOLD = 0.6;

export type PaymentConfigDto = {
  bankName: string;
  accountHolderName: string;
  accountNumber: string | null;
  aliasOrPhone: string | null;
  instructions: string | null;
  acceptsCash: boolean;
  isActive: boolean;
  hasQr: boolean;
  /** PASS, WARN (REPP reviews it; nothing is blocked) or UNKNOWN (no approved KYC yet). */
  holderMatch: string | null;
  updatedAt: string;
};

export function holderMatchOf(score: number | null): 'PASS' | 'WARN' | 'UNKNOWN' {
  if (score === null) return 'UNKNOWN';
  return score >= HOLDER_MATCH_THRESHOLD ? 'PASS' : 'WARN';
}

function mapConfig(config: EntityPaymentConfigModel): PaymentConfigDto {
  return {
    bankName: config.bankName,
    accountHolderName: config.accountHolderName,
    accountNumber: config.accountNumber,
    aliasOrPhone: config.aliasOrPhone,
    instructions: config.instructions,
    acceptsCash: config.acceptsCash,
    isActive: config.isActive,
    hasQr: Boolean(config.qrPrivateKey),
    holderMatch: config.holderMatch,
    updatedAt: config.updatedAt.toISOString(),
  };
}

/**
 * `business/me/payment-config` (ADR-0024): bank, holder and QR of the
 * business, private (only a buyer of an open order reads them, D5). The QR is
 * an uploaded file, encrypted, never a URL. A holder that does not look like
 * the KYC's legal name or representative is flagged for REPP's post-review.
 */
@Injectable()
export class PaymentConfigService {
  constructor(
    private readonly sequelize: Sequelize,
    private readonly accounts: BusinessAccountsRepository,
    private readonly sellers: SellersRepository,
    private readonly evidence: PaymentEvidenceStore,
    private readonly mediaRelease: MediaReleaseService,
  ) {}

  async get(actor: AuthenticatedUser): Promise<PaymentConfigDto | null> {
    const account = await this.account(actor);
    const config = await this.sellers.findConfig(account.entityId);
    return config ? mapConfig(config) : null;
  }

  async save(actor: AuthenticatedUser, input: PaymentConfigInput): Promise<PaymentConfigDto> {
    const account = await this.account(actor);
    const saved = await this.sequelize.transaction(async (transaction) => {
      await this.lockEditable(actor, transaction);
      const before = await this.sellers.findConfig(account.entityId, transaction);
      const { score, submissionId } = await this.sellers.holderSimilarity(account.entityId, input.accountHolderName, transaction);
      const holderMatch = holderMatchOf(score);
      const config = await this.sellers.saveConfig(
        account.entityId,
        { ...input, holderMatch, holderSimilarity: score === null ? null : score.toFixed(3) },
        transaction,
      );
      const holderChanged = before?.accountHolderName !== input.accountHolderName;
      if (holderMatch === 'WARN' && holderChanged && submissionId && score !== null) await this.sellers.flagHolderMismatch(submissionId, score, transaction);
      return config;
    });
    return mapConfig(saved);
  }

  async uploadQr(actor: AuthenticatedUser, file: UploadedSelfie | undefined): Promise<PaymentConfigDto> {
    const account = await this.account(actor);
    const image = this.evidence.validate(file);
    const stored = await this.evidence.put(image, { category: 'payment-qr', entityId: account.entityId });
    try {
      const saved = await this.sequelize.transaction(async (transaction) => {
        await this.lockEditable(actor, transaction);
        const config = await this.sellers.findConfig(account.entityId, transaction);
        if (!config) {
          throw new DomainException(HttpStatus.CONFLICT, 'PAYMENT_CONFIG_REQUIRED', 'Primero guarda los datos de cobro (banco y titular).');
        }
        const previous = config.qrPrivateKey;
        await config.update({ qrPrivateKey: stored.key, qrMime: stored.mime }, { transaction });
        if (previous) await this.mediaRelease.requestRelease({ aggregateType: 'directory.payment_config', aggregateId: account.entityId, storageKey: previous }, transaction);
        return config;
      });
      return mapConfig(saved);
    } catch (error: unknown) {
      await this.evidence.discard(stored.key);
      throw error;
    }
  }

  async qr(actor: AuthenticatedUser): Promise<{ buffer: Buffer; mimeType: string }> {
    const config = await this.sellers.findConfig((await this.account(actor)).entityId);
    if (!config?.qrPrivateKey || !config.qrMime) throw new NotFoundException('QR no encontrado.');
    return { buffer: await this.evidence.read(config.qrPrivateKey), mimeType: config.qrMime };
  }

  private async account(actor: AuthenticatedUser): Promise<BusinessAccountRow> {
    const account = await this.accounts.findByUserId(actor.id);
    if (!account) throw new NotFoundException('Cuenta de negocio no encontrada.');
    return account;
  }

  /** Serializes writes per business; a suspended or closed one changes nothing about how it is paid. */
  private async lockEditable(actor: AuthenticatedUser, transaction: Transaction): Promise<void> {
    const account = await this.accounts.findByUserId(actor.id, transaction);
    if (!account) throw new NotFoundException('Cuenta de negocio no encontrada.');
    if (account.status === 'SUSPENDED' || account.status === 'CLOSED') {
      throw new DomainException(HttpStatus.CONFLICT, 'BUSINESS_ACCOUNT_LOCKED', 'Tu negocio no se puede editar en este estado.');
    }
    if (!(await this.accounts.lockEntity(account.entityId, transaction))) throw new NotFoundException('Negocio no encontrado.');
  }
}
