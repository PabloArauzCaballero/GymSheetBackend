import { Module } from "@nestjs/common";
import { DatabaseModule } from "../database/database.module";
import { AccountExportRepository } from "../modules/export/account-export.repository";
import { AccountExportService } from "../modules/export/account-export.service";
import { IntegrationModule } from "../modules/integration/integration.module";
import { AccountDataRunner } from "./account-data.runner";

@Module({
  imports: [DatabaseModule, IntegrationModule],
  providers: [AccountExportRepository, AccountExportService, AccountDataRunner],
})
export class AccountDataWorkerModule {}
