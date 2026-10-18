import { forwardRef, Module } from "@nestjs/common";
import { SequelizeModule } from "@nestjs/sequelize";
import { RealtimeModule } from "../../common/realtime/realtime.module";
import { MediaModule } from "../media/media.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { SocialModule } from "../social/social.module";
import { UsersModule } from "../users/users.module";
import { ChatPresenceService } from "./chat-presence.service";
import { ChatController } from "./chat.controller";
import { ChatGateway } from "./chat.gateway";
import { ChatRepository } from "./chat.repository";
import { ChatService } from "./chat.service";
import { ChatMediaCipher } from "./chat-media-cipher";
import { ChatDisappearingPurgeService } from "./chat-disappearing-purge.service";
import { ReadReceiptSettingsController } from "./read-receipt-settings.controller";
import { ReadReceiptSettingsService } from "./read-receipt-settings.service";
import { ConversationParticipantModel } from "./conversation-participant.model";
import { ConversationModel } from "./conversation.model";
import { MessageMutationsService } from "./message-mutations.service";
import { MessageVisibilityModel } from "./message-visibility.model";
import { MessageReactionModel } from "./message-reaction.model";
import { MessageModel } from "./message.model";
import { SystemChatService } from "./system-chat.service";
import { env } from "../../config/env";

@Module({
  imports: [
    UsersModule,
    forwardRef(() => SocialModule),
    RealtimeModule,
    MediaModule,
    NotificationsModule,
    SequelizeModule.forFeature([ConversationModel, ConversationParticipantModel, MessageModel, MessageVisibilityModel, MessageReactionModel]),
  ],
  controllers: [ChatController, ReadReceiptSettingsController],
  providers: [
    ChatRepository,
    ChatService,
    MessageMutationsService,
    { provide: ChatMediaCipher, useFactory: () => new ChatMediaCipher(env.CHAT_MEDIA_ENCRYPTION_KEY ?? env.JWT_REFRESH_SECRET) },
    ChatPresenceService,
    ChatGateway,
    SystemChatService,
    ReadReceiptSettingsService,
    ChatDisappearingPurgeService,
  ],
  exports: [ChatService, ChatRepository],
})
export class ChatModule {}
