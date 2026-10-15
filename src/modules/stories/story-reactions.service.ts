import { BadRequestException, Injectable } from "@nestjs/common";
import { z } from "zod";
import { ChatService } from "../chat/chat.service";
import { MessageResponse } from "../chat/chat.mapper";
import { StoriesService } from "./stories.service";

export const reactToStorySchema = z.object({
  emoji: z.string().trim().min(1).max(32),
  requestId: z.string().uuid(),
}).strict();

export const replyToStorySchema = z.object({
  text: z.string().trim().min(1).max(4000),
  requestId: z.string().uuid(),
}).strict();

export type ReplyToStoryInput = z.infer<typeof replyToStorySchema>;

@Injectable()
export class StoryReactionsService {
  constructor(
    private readonly stories: StoriesService,
    private readonly chat: ChatService,
  ) {}

  async reactToStory(
    storyId: string,
    actorId: string,
    tenantId: string,
    input: unknown,
  ): Promise<MessageResponse> {
    const parsed = reactToStorySchema.safeParse(input);
    if (!parsed.success) throw new BadRequestException("La reacción o requestId no son válidos.");

    const story = await this.stories.requireViewableStory(storyId, actorId);
    if (story.userId === actorId) throw new BadRequestException("No puedes reaccionar a tu propia story.");

    // getOrStartConversation vuelve a exigir una conexión aceptada. El mismo
    // requestId se guarda como clientRequestId del mensaje; ChatRepository
    // serializa los reintentos y solo publica el mensaje que creó la primera vez.
    const conversationId = await this.chat.getOrStartConversation(actorId, tenantId, story.userId);
    return this.chat.sendMessage(conversationId, actorId, parsed.data.emoji, parsed.data.requestId);
  }

  async replyToStory(
    storyId: string,
    actorId: string,
    tenantId: string,
    input: unknown,
  ): Promise<MessageResponse> {
    const parsed = replyToStorySchema.safeParse(input);
    if (!parsed.success) throw new BadRequestException("El texto o requestId no son válidos.");

    const story = await this.stories.requireViewableStory(storyId, actorId);
    if (story.userId === actorId) throw new BadRequestException("No puedes responder a tu propia story.");

    const conversationId = await this.chat.getOrStartConversation(actorId, tenantId, story.userId);
    return this.chat.sendStoryReply(conversationId, actorId, parsed.data.text, storyId, parsed.data.requestId);
  }
}
