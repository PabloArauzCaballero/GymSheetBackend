import { Module } from "@nestjs/common";
import { SequelizeModule } from "@nestjs/sequelize";
import { setTimeout as delay } from "node:timers/promises";
import { DatabaseModule } from "../database/database.module";
import { MediaModule } from "../modules/media/media.module";
import { PhotoVerificationModel } from "../modules/verification/photo-verification.model";
import { VerificationRepository } from "../modules/verification/verification.repository";
import {
  VERIFICATION_RETENTION_SLEEP,
  VerificationRetentionService,
} from "../modules/verification/verification-retention.service";

/** Minimal context for the selfie retention command: database, verification rows and media storage. */
@Module({
  imports: [DatabaseModule, SequelizeModule.forFeature([PhotoVerificationModel]), MediaModule],
  providers: [
    VerificationRepository,
    VerificationRetentionService,
    { provide: VERIFICATION_RETENTION_SLEEP, useValue: (ms: number) => delay(ms) },
  ],
})
export class VerificationMaintenanceModule {}
