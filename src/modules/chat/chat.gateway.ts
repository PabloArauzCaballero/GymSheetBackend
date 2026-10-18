import { BadRequestException, ConflictException, Logger } from "@nestjs/common";
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from "@nestjs/websockets";
import type { Server, Socket } from "socket.io";

/** Lo único que este gateway guarda en `socket.data`, tras autenticar en `handleConnection`. */
interface ChatSocketData {
  userId?: string;
  /** Se resuelve cuando `handleConnection` terminó de autenticar (con éxito o no). */
  authenticated?: Promise<void>;
}

function socketUserId(client: Socket): string | undefined {
  return (client.data as ChatSocketData).userId;
}

/**
 * El cliente recibe `connect` antes de que el boleto se haya canjeado: un
 * `conversation:join` emitido en ese instante llegaba sin identidad y
 * respondía `joined: false`, dejando el hilo sin eventos en vivo. Los
 * manejadores asíncronos esperan a que la autenticación termine.
 */
async function authenticatedUserId(client: Socket): Promise<string | undefined> {
  await (client.data as ChatSocketData).authenticated;
  return socketUserId(client);
}
import { env } from "../../config/env";
import { SocketTicketService } from "../../common/realtime/socket-ticket.service";
import { UsersRepository } from "../users/users.repository";
import { ChatEventsService } from "./chat-events.service";
import { ChatPresenceService } from "./chat-presence.service";
import { ChatRepository } from "./chat.repository";
import { ChatService } from "./chat.service";
import { sendMessageSchema, typingSchema } from "./chat.schemas";
import { z } from "zod";

const conversationLeaveSchema = z.object({ conversationId: z.string().uuid() }).strict();

/**
 * Un socket se autentica una vez, al conectar, cambiando un boleto de un solo
 * uso (emitido por `POST /auth/socket-ticket`, ya autenticado por REST) por
 * la identidad — no un JWT crudo, para que el navegador (que solo habla con
 * rutas BFF) nunca tenga que sostener el token de acceso. Cada socket solo
 * puede unirse a la sala de una conversación de la que sea participante
 * (verificado en `conversation:join`); no hay una sala "global" a la que
 * unirse sin pedirlo.
 */
@WebSocketGateway({
  namespace: "/chat",
  cors: { origin: env.CORS_ORIGINS, credentials: true },
})
export class ChatGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(ChatGateway.name);

  @WebSocketServer()
  server!: Server;

  constructor(
    private readonly socketTickets: SocketTicketService,
    private readonly usersRepository: UsersRepository,
    private readonly chatRepository: ChatRepository,
    private readonly chatService: ChatService,
    private readonly chatEvents: ChatEventsService,
    private readonly presence: ChatPresenceService,
  ) {}

  afterInit(server: Server): void {
    this.chatEvents.setServer(server);
  }

  async handleConnection(client: Socket): Promise<void> {
    let markAuthenticated: () => void = () => undefined;
    (client.data as ChatSocketData).authenticated = new Promise<void>((resolve) => {
      markAuthenticated = resolve;
    });
    try {
      const ticket = this.extractTicket(client);
      if (!ticket) throw new Error("missing ticket");
      const userId = await this.socketTickets.consume(ticket);
      if (!userId) throw new Error("invalid or expired ticket");
      // Misma revalidación que el REST: una cuenta ya inactiva no debe poder
      // abrir un socket solo porque el boleto todavía no venció.
      const user = await this.usersRepository.findActiveById(userId);
      if (!user) throw new Error("inactive user");

      (client.data as ChatSocketData).userId = user.id;
      markAuthenticated();

      // Solo la PRIMERA conexión activa de la cuenta la pone "en línea" —
      // abrir una segunda pestaña no debe reiniciar nada para quien ya la ve.
      const becameOnline = this.presence.markConnected(user.id, client.id);
      if (becameOnline) await this.broadcastPresence(user.id, true, null);
    } catch (error: unknown) {
      this.logger.warn({ event: "chat.socket_rejected", error: error instanceof Error ? error.message : "unknown" });
      client.disconnect(true);
    } finally {
      markAuthenticated();
    }
  }

  async handleDisconnect(client: Socket): Promise<void> {
    const userId = socketUserId(client);
    if (!userId) return;

    // Solo cuando se cierra el ÚLTIMO socket de la cuenta pasa a "offline" —
    // y ahí, y solo ahí, se escribe cuándo fue visto por última vez.
    const becameOffline = this.presence.markDisconnected(userId, client.id);
    if (!becameOffline) return;
    // La presencia es de mejor esfuerzo: un fallo aquí (p. ej. un socket que se
    // cierra mientras la app se apaga y el pool ya no existe) no puede quedar
    // como promesa rechazada sin capturar.
    try {
      await this.usersRepository.touchLastSeen(userId);
      await this.broadcastPresence(userId, false, new Date().toISOString());
    } catch (error) {
      this.logger.warn({
        event: "chat.presence_offline_failed",
        error: error instanceof Error ? error.message : "unknown",
      });
    }
  }

  /** Solo llega a quien tenga abierta una conversación con esta persona ahora mismo. */
  private async broadcastPresence(
    userId: string,
    online: boolean,
    lastSeenAt: string | null,
  ): Promise<void> {
    const conversationIds = await this.chatRepository.conversationIdsForUser(userId);
    for (const conversationId of conversationIds) {
      this.chatEvents.emitPresence(conversationId, { userId, online, lastSeenAt });
    }
  }

  @SubscribeMessage("conversation:join")
  async joinConversation(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { conversationId?: string },
  ): Promise<{ joined: boolean }> {
    const userId = await authenticatedUserId(client);
    const conversationId = payload?.conversationId;
    if (!userId || !conversationId) return { joined: false };

    let roomJoined = false;
    try {
      const joined = await this.chatRepository.withActiveConversationLock(conversationId, async (transaction) => {
        const isParticipant = await this.chatRepository.isParticipant(conversationId, userId, transaction);
        if (!isParticipant) return false;
        await client.join(ChatEventsService.roomFor(conversationId));
        roomJoined = true;
        // Keep validation, room join and initial delivery under the conversation
        // lock so a concurrent revoke either wins first or evicts this socket after.
        await this.chatService.markDelivered(conversationId, userId);
        return true;
      });
      return { joined };
    } catch (error) {
      if (roomJoined) {
        try {
          await client.leave(ChatEventsService.roomFor(conversationId));
        } catch {
          // Preserve the original join or transaction error.
        }
      }
      throw error;
    }
  }

  @SubscribeMessage("conversation:leave")
  async leaveConversation(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: unknown,
  ): Promise<{ left: boolean }> {
    if (!socketUserId(client)) return { left: false };
    const parsed = conversationLeaveSchema.safeParse(payload);
    if (!parsed.success) return { left: false };
    await client.leave(ChatEventsService.roomFor(parsed.data.conversationId));
    return { left: true };
  }

  @SubscribeMessage("message:send")
  async handleMessage(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { conversationId?: string; body?: string; clientRequestId?: string; replyToId?: string },
  ): Promise<{ ok: boolean; error?: string; messageId?: string; clientRequestId?: string | null }> {
    const userId = await authenticatedUserId(client);
    if (!userId) return { ok: false, error: "unauthenticated" };
    const conversationId = payload?.conversationId;
    const parsed = sendMessageSchema.safeParse({
      body: payload?.body,
      clientRequestId: payload?.clientRequestId,
      replyToId: payload?.replyToId,
    });
    if (!conversationId || !parsed.success || parsed.data.type !== "text") {
      return { ok: false, error: "invalid_payload" };
    }

    try {
      const message = await this.chatService.sendMessage(
        conversationId, userId, parsed.data.body as string, parsed.data.clientRequestId, parsed.data.replyToId,
      );
      return { ok: true, messageId: message.id, clientRequestId: message.clientRequestId };
    } catch (error) {
      if (error instanceof ConflictException) return { ok: false, error: "idempotency_conflict" };
      if (error instanceof BadRequestException) return { ok: false, error: "reply_unavailable" };
      return { ok: false, error: "not_a_participant" };
    }
  }

  /**
   * «Escribiendo…»: solo quien ya está en la sala (pasó la verificación de
   * participante en `conversation:join`) puede anunciarlo, y le llega al resto
   * de la sala, nunca de vuelta a quien escribe. No se guarda nada.
   */
  @SubscribeMessage("typing")
  handleTyping(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: unknown,
  ): { ok: boolean } {
    const userId = socketUserId(client);
    if (!userId) return { ok: false };
    const parsed = typingSchema.safeParse(payload);
    if (!parsed.success) return { ok: false };
    const room = ChatEventsService.roomFor(parsed.data.conversationId);
    if (!client.rooms.has(room)) return { ok: false };
    client.to(room).emit("typing:update", {
      conversationId: parsed.data.conversationId,
      userId,
      typing: parsed.data.typing,
    });
    return { ok: true };
  }

  private extractTicket(client: Socket): string | null {
    const fromAuth = client.handshake.auth?.["ticket"] as string | undefined;
    if (fromAuth) return fromAuth;
    const fromQuery = client.handshake.query?.["ticket"];
    if (typeof fromQuery === "string") return fromQuery;
    return null;
  }
}
