import { Module } from "@nestjs/common";
import { BusinessOrdersCoreModule } from "../business-orders/business-orders-core.module";
import { IntegrationModule } from "../integration/integration.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { BusinessClosureNotices } from "./business-closure-notices";
import { BusinessClosureRepository } from "./business-closure.repository";
import { BusinessClosureService } from "./business-closure.service";

/** The business side of `DELETE /me/account` for a business account (ADR-0028); used by AccountModule. */
@Module({
  imports: [BusinessOrdersCoreModule, IntegrationModule, NotificationsModule],
  providers: [BusinessClosureRepository, BusinessClosureNotices, BusinessClosureService],
  exports: [BusinessClosureService],
})
export class BusinessClosureModule {}
