import { randomInt } from "node:crypto";

/** Lifecycle of one verification attempt (`social.photo_verifications.status`). */
export const VerificationStatus = {
  PENDING_UPLOAD: "PENDING_UPLOAD",
  PENDING_REVIEW: "PENDING_REVIEW",
  APPROVED: "APPROVED",
  REJECTED: "REJECTED",
  EXPIRED: "EXPIRED",
} as const;
export type VerificationStatusValue = (typeof VerificationStatus)[keyof typeof VerificationStatus];

/** Closed list of rejection reasons, with the text the member reads. */
export const VERIFICATION_REJECTION_REASONS = {
  FACE_NOT_VISIBLE: "No se ve bien tu cara en la selfie.",
  GESTURE_MISMATCH: "El gesto de la selfie no coincide con el que te pedimos.",
  DOES_NOT_MATCH_PHOTOS: "La selfie no coincide con las fotos de tu perfil.",
  MULTIPLE_PEOPLE: "En la selfie aparece más de una persona.",
  LOW_QUALITY: "La selfie está borrosa o muy oscura.",
  OTHER: "No pudimos confirmar tu identidad con esta selfie.",
} as const;
export type VerificationRejectionReason = keyof typeof VERIFICATION_REJECTION_REASONS;
export const VERIFICATION_REJECTION_REASON_CODES = Object.keys(
  VERIFICATION_REJECTION_REASONS,
) as [VerificationRejectionReason, ...VerificationRejectionReason[]];

/** Gestures a member may be asked to perform; the instruction is shown as-is. */
export const VERIFICATION_GESTURES = {
  THUMB_UP: "Haz un pulgar arriba junto a tu cara",
  PEACE_SIGN: "Haz el signo de la paz con la mano junto a tu cara",
  HAND_ON_CHIN: "Apoya la mano en tu barbilla",
  TOUCH_EAR: "Tócate una oreja con la mano",
  POINT_UP: "Señala hacia arriba con el dedo índice junto a tu cara",
  OPEN_PALM: "Muestra la palma abierta junto a tu cara",
  WINK_THUMB: "Guiña un ojo y haz un pulgar arriba",
  CHIN_UP: "Levanta la barbilla mirando a la cámara",
} as const;
export type VerificationGestureCode = keyof typeof VERIFICATION_GESTURES;
const GESTURE_CODES = Object.keys(VERIFICATION_GESTURES) as VerificationGestureCode[];

export type VerificationGesture = { code: VerificationGestureCode; instruction: string };

export function describeGesture(code: VerificationGestureCode): VerificationGesture {
  return { code, instruction: VERIFICATION_GESTURES[code] };
}

/**
 * Random gesture, never the one of the member's previous attempt, so a selfie
 * taken for an earlier challenge cannot be replayed. `pick` is injectable only
 * for tests; production uses the CSPRNG.
 */
export function pickGesture(
  previous: string | null,
  pick: (maxExclusive: number) => number = (maxExclusive) => randomInt(maxExclusive),
): VerificationGesture {
  const candidates = GESTURE_CODES.filter((code) => code !== previous);
  const index = pick(candidates.length);
  return describeGesture(candidates[index]);
}
