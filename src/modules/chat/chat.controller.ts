import { BadRequestException, Body, Controller, Delete, Get, Header, Param, Patch, Post, Query, StreamableFile, UploadedFile, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { UuidParamPipe } from "../../common/pipes/uuid-param.pipe";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { AuthenticatedUser } from "../../common/types/auth-context.types";
import { env } from "../../config/env";
import { MessageMutationsService } from "./message-mutations.service";
import { ChatService, UploadedChatMedia } from "./chat.service";
import {
  DeleteMessageInput,
  deleteMessageSchema,
  EditMessageInput,
  editMessageSchema,
  MessageListQuery,
  SendMediaMessageInput,
  SendMessageInput,
  SetNicknameInput,
  StartConversationInput,
  messageListQuerySchema,
  sendMediaMessageSchema,
  sendMessageSchema,
  setNicknameSchema,
  startConversationSchema,
} from "./chat.schemas";

/**
 * REST además del gateway de sockets: historial (paginado hacia atrás) y
 * envío para cuando el socket todavía no conectó. `message:send` por socket y
 * `POST .../messages` aquí llaman al mismo `ChatService.sendMessage`, así que
 * cualquiera de los dos caminos termina emitiendo por el socket igual.
 */
@Controller("me/conversations")
export class ChatController {
  constructor(
    private readonly service: ChatService,
    private readonly mutations: MessageMutationsService,
  ) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.service.listConversations(user.id);
  }

  @Post()
  start(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(startConversationSchema)) input: StartConversationInput,
  ) {
    return this.service
      .getOrStartConversation(user.id, user.tenantId, input.otherUserId)
      .then((conversationId) => ({ conversationId }));
  }

  @Get(":id/messages")
  listMessages(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", UuidParamPipe) conversationId: string,
    @Query(new ZodValidationPipe(messageListQuerySchema)) query: MessageListQuery,
  ) {
    return this.service.listMessages(conversationId, user.id, query.limit, query.before, query.beforeId);
  }

  @Post(":id/messages")
  sendMessage(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", UuidParamPipe) conversationId: string,
    @Body(new ZodValidationPipe(sendMessageSchema)) input: SendMessageInput,
  ) {
    if (input.type === "sticker") {
      return this.service.sendStickerMessage(conversationId, user.id, input.stickerId, input.clientRequestId);
    }
    if (input.type === "location") {
      // `superRefine` en el schema ya garantiza que ambos vengan si el tipo es 'location'.
      return this.service.sendLocationMessage(conversationId, user.id, {
        lat: input.locationLat as number,
        lng: input.locationLng as number,
      }, input.clientRequestId);
    }
    return this.service.sendMessage(conversationId, user.id, input.body as string, input.clientRequestId);
  }

  @Delete(":id/messages/:messageId")
  deleteMessage(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", UuidParamPipe) conversationId: string,
    @Param("messageId", UuidParamPipe) messageId: string,
    @Query(new ZodValidationPipe(deleteMessageSchema)) input: DeleteMessageInput,
  ) {
    return this.mutations.deleteMessage(conversationId, messageId, user.id, input);
  }

  @Patch(":id/messages/:messageId")
  editMessage(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", UuidParamPipe) conversationId: string,
    @Param("messageId", UuidParamPipe) messageId: string,
    @Body(new ZodValidationPipe(editMessageSchema)) input: EditMessageInput,
  ) {
    return this.mutations.editMessage(conversationId, messageId, user.id, input);
  }

  @Post(":id/messages/media")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: env.CHAT_MEDIA_MAX_BYTES, files: 1 } }))
  sendMediaMessage(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", UuidParamPipe) conversationId: string,
    @UploadedFile() file: UploadedChatMedia | undefined,
    @Body(new ZodValidationPipe(sendMediaMessageSchema)) input: SendMediaMessageInput,
  ) {
    if (!file) throw new BadRequestException("Se requiere un archivo.");
    return this.service.sendMediaMessage(conversationId, user.id, file, {
      type: input.type,
      body: input.body,
      viewOnce: input.viewOnce,
    });
  }

  @Post(":id/messages/:messageId/view")
  viewMessage(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", UuidParamPipe) conversationId: string,
    @Param("messageId", UuidParamPipe) messageId: string,
  ) {
    return this.service.viewMessage(conversationId, messageId, user.id);
  }

  @Get(":id/messages/:messageId/media")
  @Header("Cache-Control", "private, no-store")
  @Header("X-Content-Type-Options", "nosniff")
  async media(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", UuidParamPipe) conversationId: string,
    @Param("messageId", UuidParamPipe) messageId: string,
  ): Promise<StreamableFile> {
    const media = await this.service.downloadMedia(conversationId, messageId, user.id);
    return new StreamableFile(media.buffer, { type: media.mimeType, disposition: "inline" });
  }

  @Patch(":id/nickname")
  setNickname(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", UuidParamPipe) conversationId: string,
    @Body(new ZodValidationPipe(setNicknameSchema)) input: SetNicknameInput,
  ) {
    return this.service.setNickname(conversationId, user.id, input.nickname);
  }

  @Post(":id/read")
  markRead(@CurrentUser() user: AuthenticatedUser, @Param("id", UuidParamPipe) conversationId: string) {
    return this.service.markRead(conversationId, user.id);
  }
}
