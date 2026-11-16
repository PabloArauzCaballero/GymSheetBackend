import { Module } from "@nestjs/common";
import { SequelizeModule } from "@nestjs/sequelize";
import { SignupAuditModel } from "./signup-audit.model";
import { SignupAuditRepository } from "./signup-audit.repository";
import { SignupRetentionService } from "./signup-retention.service";
import { SignupTicketModel } from "./signup-ticket.model";
import { TicketLedgerRepository } from "./ticket-ledger.repository";

/** Data access only, so the retention command can boot without HTTP, Redis or env-derived secrets. */
@Module({
  imports: [SequelizeModule.forFeature([SignupTicketModel, SignupAuditModel])],
  providers: [TicketLedgerRepository, SignupAuditRepository, SignupRetentionService],
  exports: [TicketLedgerRepository, SignupAuditRepository, SignupRetentionService],
})
export class AntibotPersistenceModule {}
