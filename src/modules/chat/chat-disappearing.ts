/** Duraciones permitidas para los mensajes temporales: 24 h, 7 días y 90 días (como WhatsApp). */
export const DISAPPEARING_SECONDS = [86_400, 604_800, 7_776_000] as const;
export type DisappearingSeconds = (typeof DISAPPEARING_SECONDS)[number];

/** Cuándo caduca un mensaje enviado ahora con el modo vigente; `null` si el modo está desactivado. */
export function expiryFor(seconds: number | null, now: Date): Date | null {
  return seconds ? new Date(now.getTime() + seconds * 1_000) : null;
}

/** Un mensaje caducado ya no existe para nadie, aunque la purga todavía no haya borrado la fila. */
export function isExpired(message: { expiresAt: Date | null }, now: Date = new Date()): boolean {
  return message.expiresAt !== null && message.expiresAt.getTime() <= now.getTime();
}
