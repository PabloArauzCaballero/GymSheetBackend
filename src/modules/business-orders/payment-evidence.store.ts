import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { DomainException } from '../../common/errors/domain.exception';
import { env } from '../../config/env';
import { validateBusinessImage } from '../business-accounts/business-accounts.service';
import { KycCipher } from '../business-kyc/kyc-cipher';
import { MEDIA_STORAGE_PROVIDER, MediaStorageProvider } from '../media/media-storage.port';
import { UploadedSelfie } from '../verification/selfie-image';

/** A stored, encrypted payment file and what the row keeps about its plaintext. */
export type StoredEvidence = { key: string; mime: string; sha256: string };

/** Payment evidence uses the KYC key with its own derivation domain (ADR-0024). */
export const PAYMENT_EVIDENCE_CIPHER = Symbol('PAYMENT_EVIDENCE_CIPHER');
export const paymentEvidenceCipher = (): KycCipher => new KycCipher(() => env.KYC_ENCRYPTION_KEY, 'gymsheet:payment-evidence:v1');

function unavailable(): DomainException {
  return new DomainException(HttpStatus.SERVICE_UNAVAILABLE, 'PAYMENT_EVIDENCE_UNAVAILABLE', 'Los comprobantes no están disponibles en este momento.');
}

/**
 * Receipts and payment QRs (ADR-0024): JPEG/PNG checked by bytes, encrypted
 * with AES-256-GCM before they leave the process, stored under a private
 * prefix the static mount refuses and MinIO does not publish, and read back
 * only through an authorized route. The plaintext hash is kept so a dispute
 * can prove which image was sent without exposing it.
 */
@Injectable()
export class PaymentEvidenceStore {
  private readonly logger = new Logger(PaymentEvidenceStore.name);

  constructor(
    @Inject(PAYMENT_EVIDENCE_CIPHER) private readonly cipher: KycCipher,
    @Inject(MEDIA_STORAGE_PROVIDER) private readonly storage: MediaStorageProvider,
  ) {}

  /** Validates the file before anything else happens (400 for a bad file, 503 without the key). */
  validate(file: UploadedSelfie | undefined): UploadedSelfie & { mimeType: string } {
    if (!env.KYC_ENCRYPTION_KEY) throw unavailable();
    return validateBusinessImage(file);
  }

  async put(
    image: UploadedSelfie & { mimeType: string },
    target: { category: 'order-receipt'; orderId: string } | { category: 'payment-qr'; entityId: string },
  ): Promise<StoredEvidence> {
    const encrypted = this.cipher.encrypt(image.buffer);
    const stored = await this.storage.upload(
      { originalName: 'evidence', mimeType: 'application/octet-stream', sizeBytes: encrypted.byteLength, buffer: encrypted },
      { ...target, objectId: randomUUID() },
    );
    return { key: stored.key, mime: image.mimeType, sha256: createHash('sha256').update(image.buffer).digest('hex') };
  }

  async read(key: string): Promise<Buffer> {
    if (!env.KYC_ENCRYPTION_KEY) throw unavailable();
    return this.cipher.decrypt(await this.storage.download(key));
  }

  /** A file no row came to reference (the write failed after the upload) is removed at once. */
  async discard(key: string): Promise<void> {
    try {
      await this.storage.remove(key);
    } catch (error: unknown) {
      this.logger.warn({ event: 'payment_evidence.discard_failed', errorName: error instanceof Error ? error.name : 'UnknownError' });
    }
  }
}
