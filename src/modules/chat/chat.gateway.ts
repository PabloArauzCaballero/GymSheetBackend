import { Logger } from "@nestjs/common";
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
}

function socketUserId(client: Socket): string | undefined {
  return (client.data as ChatSocketData).userId;
}
import { env } from "../../config/env";
import { SocketTicketService } from "../../common/realtime/socket-ticket.service";
import { UsersRepository } from "../users/users.repository";
import { ChatEventsService } from "./chat-events.service";
import { ChatPresenceService } from "./chat-presence.service";
import { ChatRepository } from "./chat.repository";
import { ChatService } from "./chat.service";

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

      // Solo la PRIMERA conexión activa de la cuenta la pone "en línea" —
      // abrir una segunda pestaña no debe reiniciar nada para quien ya la ve.
      const becameOnline = this.presence.markConnected(user.id, client.id);
      if (becameOnline) await this.broadcastPresence(user.id, true, null);
    } catch (error: unknown) {
      this.logger.warn({ event: "chat.socket_rejected", error: error instanceof Error ? error.message : "unknown" });
      client.disconnect(true);
    }
  }

  async handleDisconnect(client: Socket): Promise<void> {
    const userId = socketUserId(client);
    if (!userId) return;

    // Solo cuando se cierra el ÚLTIMO socket de la cuenta pasa a "offline" —
    // y ahí, y solo ahí, se escribe cuándo fue visto por última vez.
    const becameOffline = this.presence.markDisconnected(userId, client.id);
    if (!becameOffline) return;
    await this.usersRepository.touchLastSeen(userId);
    await this.broadcastPresence(userId, false, new Date().toISOString());
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
    const userId = socketUserId(client);
    const conversationId = payload?.conversationId;
    if (!userId || !conversationId) return { joined: false };

    const isParticipant = await this.chatRepository.isParticipant(conversationId, userId);
    if (!isParticipant) return { joined: false };
    await client.join(ChatEventsService.roomFor(conversationId));
    // Unirse a la sala en vivo es, como mínimo, haber recibido lo que ya
    // había — cubre a quien nunca hizo el fetch REST antes de conectar.
    await this.chatService.markDelivered(conversationId, userId);
    return { joined: true };
  }

  @SubscribeMessage("message:send")
  async handleMessage(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { conversationId?: string; body?: string },
  ): Promise<{ ok: boolean; error?: string }> {
    const userId = socketUserId(client);
    if (!userId) return { ok: false, error: "unauthenticated" };
    const conversationId = payload?.conversationId;
    const body = payload?.body?.trim();
    if (!conversationId || !body || body.length > 4000) {
      return { ok: false, error: "invalid_payload" };
    }

    try {
      await this.chatService.sendMessage(conversationId, userId, body);
      return { ok: true };
    } catch {
      return { ok: false, error: "not_a_participant" };
    }
  }

  private extractTicket(client: Socket): string | null {
    const fromAuth = client.handshake.auth?.["ticket"] as string | undefined;
    if (fromAuth) return fromAuth;
    const fromQuery = client.handshake.query?.["ticket"];
    if (typeof fromQuery === "string") return fromQuery;
    return null;
  }
}
