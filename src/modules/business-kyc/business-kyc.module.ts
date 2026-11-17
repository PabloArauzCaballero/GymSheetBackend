import { Module } from "@nestjs/common";
import { SequelizeModule } from "@nestjs/sequelize";
import { env } from "../../config/env";
import { AdminAccessModule } from "../admin-access/admin-access.module";
import { BusinessAccountsModule } from "../business-accounts/business-accounts.module";
import { ConsentsModule } from "../consents/consents.module";
import { DirectoryEntityModel } from "../directory/directory-entity.model";
import { IntegrationModule } from "../integration/integration.module";
import { MediaModule } from "../media/media.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { AdminBusinessKycController } from "./admin-business-kyc.controller";
import { AdminBusinessController } from "./admin-business.controller";
import { BusinessAdminService } from "./business-admin.service";
import { BusinessKycController } from "./business-kyc.controller";
import { IMAGE_MODERATION_PORT, NoopImageModeration } from "./image-moderation/image-moderation.port";
import { ImageModerationService } from "./image-moderation/image-moderation.service";
import { KycCheckQueriesRepository } from "./kyc-check-queries.repository";
import { KycCipher } from "./kyc-cipher";
import { KycDraftsService } from "./kyc-drafts.service";
import { KycEffectsRepository } from "./kyc-effects.repository";
import { KycNotices } from "./kyc-notices";
import { KYC_CHECK_QUERIES, KYC_CLOCK, KYC_PIPELINE_CONFIG, KycPipelineService, defaultKycPipelineConfig } from "./kyc-pipeline.service";
import { KycReviewRepository } from "./kyc-review.repository";
import { KycReviewService } from "./kyc-review.service";
import { KycStatusService } from "./kyc-status.service";
import { KycSubmitService } from "./kyc-submit.service";
import { KycRepository } from "./kyc.repository";
import { DisabledPhoneOtpSender, PHONE_OTP_FETCH, PHONE_OTP_SENDER, PhoneOtpFetch, PhoneOtpSender } from "./phone/phone-otp.port";
import { PhoneVerificationService } from "./phone/phone-verification.service";
import { WhatsAppCloudOtpSender } from "./phone/whatsapp-cloud-otp.sender";

const WHATSAPP_TIMEOUT_MS = 8000;

/** `BUSINESS_PHONE_OTP_PROVIDER` picks the sender; `env.ts` already refused an incomplete WhatsApp configuration. */
export function phoneOtpSenderFactory(fetcher: PhoneOtpFetch): PhoneOtpSender {
  if (env.BUSINESS_PHONE_OTP_PROVIDER !== "whatsapp-cloud") return new DisabledPhoneOtpSender();
  return new WhatsAppCloudOtpSender(
    {
      accessToken: env.WHATSAPP_CLOUD_ACCESS_TOKEN ?? "",
      phoneNumberId: env.WHATSAPP_CLOUD_PHONE_NUMBER_ID ?? "",
      templateName: env.WHATSAPP_CLOUD_OTP_TEMPLATE ?? "",
      languageCode: env.WHATSAPP_CLOUD_TEMPLATE_LANGUAGE,
      apiVersion: env.WHATSAPP_CLOUD_API_VERSION,
      timeoutMs: WHATSAPP_TIMEOUT_MS,
    },
    fetcher,
  );
}

/** KYC of business accounts and REPP's console over them (ADR-0021, franja 8b). */
@Module({
  imports: [
    SequelizeModule.forFeature([DirectoryEntityModel]),
    BusinessAccountsModule,
    ConsentsModule,
    MediaModule,
    NotificationsModule,
    IntegrationModule,
    AdminAccessModule,
  ],
  controllers: [BusinessKycController, AdminBusinessKycController, AdminBusinessController],
  providers: [
    KycRepository,
    KycEffectsRepository,
    KycReviewRepository,
    { provide: KYC_CHECK_QUERIES, useClass: KycCheckQueriesRepository },
    { provide: KYC_CLOCK, useValue: () => new Date() },
    { provide: KYC_PIPELINE_CONFIG, useFactory: defaultKycPipelineConfig },
    { provide: KycCipher, useFactory: () => new KycCipher() },
    { provide: PHONE_OTP_FETCH, useValue: ((input, init) => fetch(input, init)) satisfies PhoneOtpFetch },
    { provide: PHONE_OTP_SENDER, useFactory: phoneOtpSenderFactory, inject: [PHONE_OTP_FETCH] },
    { provide: IMAGE_MODERATION_PORT, useClass: NoopImageModeration },
    KycPipelineService,
    PhoneVerificationService,
    ImageModerationService,
    KycNotices,
    KycDraftsService,
    KycSubmitService,
    KycStatusService,
    KycReviewService,
    BusinessAdminService,
  ],
  // Moderation cases about a listing or a profile suspend the business (ADR-0022).
  exports: [BusinessAdminService],
})
export class BusinessKycModule {}
