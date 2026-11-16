import { Module } from "@nestjs/common";
import { DatabaseModule } from "../database/database.module";
import { AccountClosureRepository } from "../modules/account/account-closure.repository";
import { AccountClosureService } from "../modules/account/account-closure.service";
import { EmailVerificationPinRepository } from "../modules/auth/email-verification-pin.repository";
import { EmailVerificationService } from "../modules/auth/email-verification.service";
import { ClosedAccountSanctionsModule } from "../modules/closed-account-sanctions/closed-account-sanctions.module";
import { AccountExportRepository } from "../modules/export/account-export.repository";
import { AccountExportService } from "../modules/export/account-export.service";
import { IntegrationModule } from "../modules/integration/integration.module";
import { MediaModule } from "../modules/media/media.module";
import { NotificationsModule } from "../modules/notifications/notifications.module";
import { UsersModule } from "../modules/users/users.module";
import { AccountDataRunner } from "./account-data.runner";

/**
 * The closure is wired from its own providers, not through AccountModule:
 * that one pulls AuthModule, whose JwtService only the HTTP app registers.
 */
@Module({
  imports: [DatabaseModule, IntegrationModule, UsersModule, MediaModule, NotificationsModule, ClosedAccountSanctionsModule],
  providers: [
    AccountExportRepository,
    AccountExportService,
    AccountClosureRepository,
    AccountClosureService,
    EmailVerificationPinRepository,
    EmailVerificationService,
    AccountDataRunner,
  ],
})
export class AccountDataWorkerModule {}
