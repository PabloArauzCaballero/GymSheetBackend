import { BrandingModule } from "../../common/branding/branding.module";
import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { ClosedAccountSanctionsModule } from "../closed-account-sanctions/closed-account-sanctions.module";
import { IntegrationModule } from "../integration/integration.module";
import { MediaModule } from "../media/media.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { UsersModule } from "../users/users.module";
import { AccountClosureRepository } from "./account-closure.repository";
import { AccountClosureService } from "./account-closure.service";
import { AccountController } from "./account.controller";
import { AdminAccountClosureController } from "./admin-account-closure.controller";
import { EmailChangeController } from "./email-change.controller";
import { EmailChangeService } from "./email-change.service";

/** Account rights (franja 4): rename, email change and closure. The export lives in ExportModule. */
@Module({
  imports: [BrandingModule, AuthModule, UsersModule, IntegrationModule, NotificationsModule, MediaModule, ClosedAccountSanctionsModule],
  controllers: [AccountController, AdminAccountClosureController, EmailChangeController],
  providers: [AccountClosureRepository, AccountClosureService, EmailChangeService],
})
export class AccountModule {}
