import { Module } from "@nestjs/common";
import { DatabaseModule } from "../database/database.module";
import { AccountMediaErasureService } from "../modules/account/account-media-erasure.service";
import { AccountExportRepository } from "../modules/export/account-export.repository";
import { AccountExportService } from "../modules/export/account-export.service";
import { IntegrationModule } from "../modules/integration/integration.module";
import { MediaModule } from "../modules/media/media.module";
import { AccountDataRunner } from "./account-data.runner";

@Module({
  imports: [DatabaseModule, IntegrationModule, MediaModule],
  providers: [AccountExportRepository, AccountExportService, AccountMediaErasureService, AccountDataRunner],
})
export class AccountDataWorkerModule {}
