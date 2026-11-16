import { Module } from "@nestjs/common";
import { SequelizeModule } from "@nestjs/sequelize";
import { env } from "../../config/env";
import { ChatMediaCipher } from "../chat/chat-media-cipher";
import { MediaModule } from "../media/media.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { PhotoVerificationModel } from "./photo-verification.model";
import { SelfieLinkSigner } from "./selfie-link.signer";
import { VerificationAdminController, VerificationController } from "./verification.controller";
import { AllowAllVerificationConsent, VERIFICATION_CONSENT_PORT } from "./verification-consent.port";
import { VERIFICATION_CLOCK } from "./verification.policy";
import { VerificationRepository } from "./verification.repository";
import { VerificationReviewService } from "./verification-review.service";
import { VerificationRevocationService } from "./verification-revocation.service";
import { VerificationService } from "./verification.service";

/**
 * Person verification (gesture selfie, manual moderation). Exports the
 * revocation rule so the profile photo gallery can apply it on deletion.
 */
@Module({
  imports: [SequelizeModule.forFeature([PhotoVerificationModel]), MediaModule, NotificationsModule],
  controllers: [VerificationController, VerificationAdminController],
  providers: [
    VerificationRepository,
    VerificationService,
    VerificationReviewService,
    VerificationRevocationService,
    // Same at-rest encryption as chat attachments: storage only ever holds ciphertext.
    { provide: ChatMediaCipher, useFactory: () => new ChatMediaCipher(env.CHAT_MEDIA_ENCRYPTION_KEY ?? env.JWT_REFRESH_SECRET) },
    { provide: SelfieLinkSigner, useFactory: () => new SelfieLinkSigner(env.JWT_ACCESS_SECRET) },
    // Bind to the consents ledger adapter (kind VERIFICATION_SELFIE) when that module is merged.
    { provide: VERIFICATION_CONSENT_PORT, useClass: AllowAllVerificationConsent },
    { provide: VERIFICATION_CLOCK, useValue: () => new Date() },
  ],
  exports: [VerificationRevocationService],
})
export class VerificationModule {}
