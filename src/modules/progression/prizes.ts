import { randomInt } from "node:crypto";

/**
 * Premios del gimnasio (P1, PLAN_RUTINAS_REPP/12).
 *
 * Un premio es algo real que da el gimnasio —«batido gratis», «pase de un día
 * para un amigo»— atado a un hito de la senda. Al conseguirlo nace un cupón
 * con código, que el socio enseña en recepción y el gimnasio canjea una vez.
 *
 * Sustituye a las recompensas por racha (`STREAK_REWARD_*`), que eran
 * «features» sin objeto: decían «Racha de 7 días» pero no qué te llevabas.
 */

export type PrizeTargetKind = "BADGE" | "LEVEL" | "PERFECT_WEEK";
export type PrizeStatus = "DISPONIBLE" | "CANJEADO" | "CADUCADO";

/** Código de la «semana redonda» como objetivo de un premio: no es una insignia ni un rango. */
export const PERFECT_WEEK_TARGET_CODE = "SEMANA_REDONDA";

/**
 * Alfabeto del código: sin 0/O ni 1/I, que se confunden al leerlo en voz alta o
 * en una pantalla con brillo bajo. 32 símbolos, seis posiciones: unos mil
 * millones de códigos, de sobra para que adivinar uno ajeno no sea un plan.
 */
export const PRIZE_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const PRIZE_CODE_LENGTH = 6;
export const PRIZE_CODE_PATTERN = /^[A-HJ-NP-Z2-9]{6}$/u;

/** Aleatorio criptográfico: un código predecible se canjearía antes que su dueño. */
export function generatePrizeCode(pick: (max: number) => number = randomInt): string {
  let code = "";
  for (let index = 0; index < PRIZE_CODE_LENGTH; index += 1) {
    code += PRIZE_CODE_ALPHABET[pick(PRIZE_CODE_ALPHABET.length)];
  }
  return code;
}

/**
 * Estado que se enseña. La caducidad no la escribe ningún proceso: un cupón
 * vencido se lee como `CADUCADO` en cuanto pasa la fecha, sin depender de que
 * corra un trabajo nocturno.
 */
export function effectivePrizeStatus(
  stored: PrizeStatus,
  expiresAt: Date | null,
  now: Date = new Date(),
): PrizeStatus {
  if (stored !== "DISPONIBLE") return stored;
  return expiresAt !== null && expiresAt.getTime() <= now.getTime() ? "CADUCADO" : "DISPONIBLE";
}

/** ¿Queda stock? `null` = ilimitado. */
export function hasStock(stock: number | null, grantedCount: number): boolean {
  return stock === null || grantedCount < stock;
}

export function prizeExpiry(awardedAt: Date, validDays: number | null): Date | null {
  if (validDays === null) return null;
  return new Date(awardedAt.getTime() + validDays * 86_400_000);
}

export interface PrizeView {
  id: string;
  title: string;
  description: string | null;
  instructions: string | null;
  icon: string;
  source: { kind: PrizeTargetKind; code: string; name: string };
  code: string;
  status: PrizeStatus;
  awardedAt: string;
  expiresAt: string | null;
  redeemedAt: string | null;
  isNew: boolean;
}

/** Cupón de un socio con los datos de su premio, tal como sale del repositorio. */
export interface CouponRecord {
  id: string;
  prizeId: string;
  userId: string;
  sourceRef: string;
  code: string;
  status: PrizeStatus;
  awardedAt: Date;
  expiresAt: Date | null;
  redeemedAt: Date | null;
  seen: boolean;
  title: string;
  description: string | null;
  instructions: string | null;
  icon: string;
  targetKind: PrizeTargetKind;
  targetCode: string;
}

export function toPrizeView(coupon: CouponRecord, sourceName: string, now: Date = new Date()): PrizeView {
  return {
    id: coupon.id,
    title: coupon.title,
    description: coupon.description,
    instructions: coupon.instructions,
    icon: coupon.icon,
    source: { kind: coupon.targetKind, code: coupon.targetCode, name: sourceName },
    code: coupon.code,
    status: effectivePrizeStatus(coupon.status, coupon.expiresAt, now),
    awardedAt: coupon.awardedAt.toISOString(),
    expiresAt: coupon.expiresAt?.toISOString() ?? null,
    redeemedAt: coupon.redeemedAt?.toISOString() ?? null,
    isNew: !coupon.seen,
  };
}
