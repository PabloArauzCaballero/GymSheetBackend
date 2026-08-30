import { Inject, Injectable } from "@nestjs/common";
import { randomBytes } from "node:crypto";
import { OptionalRedisClient, REDIS_CLIENT } from "../redis/redis.module";

const TICKET_TTL_MS = 30_000;
const KEY_PREFIX = "socket-ticket:";

/**
 * Boletos de un solo uso para abrir el socket de chat sin exponer el JWT de
 * acceso al navegador (que solo habla con rutas BFF; el token vive en cookie
 * HttpOnly). El cliente pide un boleto por REST (ya autenticado) y lo cambia
 * por la identidad al conectar el socket — igual que el resto del sistema de
 * rate limiting, cae a un mapa en memoria de un solo proceso cuando no hay
 * Redis configurado.
 */
@Injectable()
export class SocketTicketService {
  private readonly memory = new Map<string, { userId: string; expiresAt: number }>();

  constructor(@Inject(REDIS_CLIENT) private readonly redis: OptionalRedisClient) {}

  async issue(userId: string): Promise<string> {
    const ticket = randomBytes(32).toString("hex");
    if (this.redis) {
      await this.redis.set(KEY_PREFIX + ticket, userId, "PX", TICKET_TTL_MS);
    } else {
      this.sweep();
      this.memory.set(ticket, { userId, expiresAt: Date.now() + TICKET_TTL_MS });
    }
    return ticket;
  }

  /** Consume el boleto: solo se puede cambiar por la identidad una vez. */
  async consume(ticket: string): Promise<string | null> {
    if (this.redis) {
      const key = KEY_PREFIX + ticket;
      const userId = await this.redis.get(key);
      if (!userId) return null;
      await this.redis.del(key);
      return userId;
    }
    const entry = this.memory.get(ticket);
    this.memory.delete(ticket);
    if (!entry || entry.expiresAt < Date.now()) return null;
    return entry.userId;
  }

  private sweep(): void {
    const now = Date.now();
    for (const [key, value] of this.memory) {
      if (value.expiresAt < now) this.memory.delete(key);
    }
  }
}
