import { Injectable, Logger } from "@nestjs/common";
import type { Server } from "socket.io";
import { MessageResponse } from "./chat.mapper";

/**
 * Puente entre el servicio de dominio y el servidor de sockets.
 *
 * Separado del gateway a propósito: `ChatService` no debe depender de una
 * clase decorada con `@WebSocketGateway`, y el gateway no debe cargar con la
 * lógica de negocio. Esto es solo la referencia al servidor y el nombre de
 * las salas, compartido por ambos sin que ninguno importe al otro.
 */
@Injectable()
export class ChatEventsService {
  private readonly logger = new Logger(ChatEventsService.name);
  private server: Server | null = null;

  setServer(server: Server): void {
    this.server = server;
  }

  /** Sala por conversación: solo sus participantes se unen a ella (ver `ChatGateway`). */
  static roomFor(conversationId: string): string {
    return `conversation:${conversationId}`;
  }

  emitMessage(message: MessageResponse): void {
    if (!this.server) {
      this.logger.warn({ event: "chat.emit_without_server", conversationId: message.conversationId });
      return;
    }
    this.server.to(ChatEventsService.roomFor(message.conversationId)).emit("message:new", message);
  }

  /**
   * Solo llega a quien tenga esa conversación abierta ahora mismo (unido a su
   * sala) — el mismo alcance que `emitMessage`, no una difusión global.
   */
  emitPresence(
    conversationId: string,
    presence: { userId: string; online: boolean; lastSeenAt: string | null },
  ): void {
    if (!this.server) return;
    this.server.to(ChatEventsService.roomFor(conversationId)).emit("presence:update", presence);
  }

  /** `userId` es quien recibió/leyó — el otro lado usa esto para pintar el check de sus propios mensajes. */
  emitDelivered(conversationId: string, receipt: { userId: string; deliveredAt: string }): void {
    if (!this.server) return;
    this.server.to(ChatEventsService.roomFor(conversationId)).emit("message:delivered", receipt);
  }

  emitRead(conversationId: string, receipt: { userId: string; readAt: string }): void {
    if (!this.server) return;
    this.server.to(ChatEventsService.roomFor(conversationId)).emit("message:read", receipt);
  }
}
