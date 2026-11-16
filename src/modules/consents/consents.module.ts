import { Module } from "@nestjs/common";
import { MediaModule } from "../media/media.module";
import { ConsentsController } from "./consents.controller";
import { ConsentsRepository } from "./consents.repository";
import { ConsentsService } from "./consents.service";

@Module({
  // The media release queue: revoking VERIFICATION_SELFIE deletes the stored selfies.
  imports: [MediaModule],
  controllers: [ConsentsController],
  providers: [ConsentsRepository, ConsentsService],
  exports: [ConsentsService],
})
export class ConsentsModule {}
