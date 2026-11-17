import { Module } from "@nestjs/common";
import { DatabaseModule } from "../database/database.module";
import { PrivacyRetentionModule } from "../modules/privacy/privacy-retention.module";
import { PrivacyRetentionRunner } from "./privacy-retention.runner";

/** Same context as the one-shot `db:privacy:retention` command, plus its daily runner. */
@Module({
  imports: [DatabaseModule, PrivacyRetentionModule],
  providers: [PrivacyRetentionRunner],
})
export class PrivacyRetentionWorkerModule {}
