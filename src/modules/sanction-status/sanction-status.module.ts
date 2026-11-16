import { Module } from "@nestjs/common";
import { SanctionStatusRepository } from "./sanction-status.repository";
import { SanctionStatusService } from "./sanction-status.service";

/** Which sanction is in force and its public reason; needs only the database connection. */
@Module({
  providers: [SanctionStatusRepository, SanctionStatusService],
  exports: [SanctionStatusService],
})
export class SanctionStatusModule {}
