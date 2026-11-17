import { Module } from "@nestjs/common";
import { ClosedAccountSanctionsRepository } from "./closed-account-sanctions.repository";
import { ClosedAccountSanctionsService } from "./closed-account-sanctions.service";

/** Ban-evasion guard shared by account closure and every signup path (ADR-0015). */
@Module({
  providers: [ClosedAccountSanctionsRepository, ClosedAccountSanctionsService],
  exports: [ClosedAccountSanctionsService],
})
export class ClosedAccountSanctionsModule {}
