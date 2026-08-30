import { Module } from "@nestjs/common";
import { SequelizeModule } from "@nestjs/sequelize";
import { RealtimeModule } from "../../common/realtime/realtime.module";
import { MediaModule } from "../media/media.module";
import { SocialModule } from "../social/social.module";
import { UsersModule } from "../users/users.module";
import { ChatEventsService } from "./chat-events.service";
import { ChatPresenceService } from "./chat-presence.service";
import { ChatController } from "./chat.controller";
import { ChatGateway } from "./chat.gateway";
import { ChatRepository } from "./chat.repository";
import { ChatService } from "./chat.service";
import { ConversationParticipantModel } from "./conversation-participant.model";
import { ConversationModel } from "./conversation.model";
import { MessageModel } from "./message.model";
import { SystemChatService } from "./system-chat.service";

@Module({
  imports: [
    UsersModule,
    SocialModule,
    RealtimeModule,
    MediaModule,
    SequelizeModule.forFeature([ConversationModel, ConversationParticipantModel, MessageModel]),
  ],
  controllers: [ChatController],
  providers: [ChatRepository, ChatService, ChatEventsService, ChatPresenceService, ChatGateway, SystemChatService],
})
export class ChatModule {}
