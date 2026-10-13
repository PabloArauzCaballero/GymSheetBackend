import { Module } from "@nestjs/common";
import { DatabaseModule } from "../../database/database.module";
import { ChatModule } from "../chat/chat.module";
import { TrainingInvitationCalendarService } from "./calendar.service";
import { TrainingInvitationsController } from "./training-invitations.controller";
import { TrainingInvitationsService } from "./training-invitations.service";
import { SharedSessionService } from "./shared-session.service";

@Module({
  imports: [DatabaseModule, ChatModule],
  controllers: [TrainingInvitationsController],
  providers: [
    TrainingInvitationsService,
    TrainingInvitationCalendarService,
    SharedSessionService,
  ],
  exports: [TrainingInvitationsService],
})
export class TrainingInvitationsModule {}
