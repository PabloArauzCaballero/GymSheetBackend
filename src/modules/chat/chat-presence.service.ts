import { Injectable } from "@nestjs/common";

/**
 * Quién tiene un socket de chat abierto ahora mismo, en memoria del proceso.
 *
 * Deliberadamente no es un registro persistente: "en línea" solo tiene
 * sentido mientras dure la conexión. Un usuario puede tener varios sockets
 * (dos pestañas, móvil y web a la vez), así que se cuenta un set por cuenta
 * y solo se considera "desconectado" cuando el último se cierra — eso es lo
 * que dispara la escritura de `last_seen_at` en `ChatGateway`.
 */
@Injectable()
export class ChatPresenceService {
  private readonly socketsByUser = new Map<string, Set<string>>();

  isOnline(userId: string): boolean {
    return (this.socketsByUser.get(userId)?.size ?? 0) > 0;
  }

  /** @returns true si esta conexión hizo pasar a la cuenta de offline a online. */
  markConnected(userId: string, socketId: string): boolean {
    const sockets = this.socketsByUser.get(userId) ?? new Set<string>();
    const wasOffline = sockets.size === 0;
    sockets.add(socketId);
    this.socketsByUser.set(userId, sockets);
    return wasOffline;
  }

  /** @returns true si este cierre dejó a la cuenta sin ningún socket abierto. */
  markDisconnected(userId: string, socketId: string): boolean {
    const sockets = this.socketsByUser.get(userId);
    if (!sockets) return false;
    sockets.delete(socketId);
    if (sockets.size === 0) {
      this.socketsByUser.delete(userId);
      return true;
    }
    return false;
  }
}
