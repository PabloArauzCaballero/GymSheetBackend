import { HttpException, HttpStatus } from '@nestjs/common';

/** Códigos estables que los clientes pueden comparar (nunca el texto del mensaje). */
export type DomainErrorCode =
  | 'ROUTINE_DUPLICATE'
  | 'PROGRAM_ACTIVE_CONFLICT'
  | 'SHARE_PENDING'
  | 'SHARE_ALREADY_EXISTS'
  | 'CANNOT_RATE_OWN'
  | 'OFFICIAL_FORBIDDEN'
  | 'ROUTINE_HAS_NO_DAYS'
  | 'CONTENT_HIDDEN'
  | 'SOCIAL_MAP_DISABLED'
  | 'ROUTINE_NOT_OWNED'
  | 'ROUTINE_GROUP_INVALID'
  | 'SET_DURATION_NOT_ALLOWED'
  | 'SET_KIND_MISMATCH'
  | 'SET_NUMBER_TAKEN'
  | 'REST_SETTING_INVALID'
  | 'SWAP_SAME_EXERCISE'
  | 'MUSIC_URL_INVALID'
  | 'MUSIC_PLAYLIST_DUPLICATE'
  | 'DISCOVERY_PREFERENCES_REQUIRED'
  | 'TERMS_VERSION_OUTDATED'
  | 'LEGAL_ACCEPTANCE_REQUIRED'
  | 'EMAIL_PIN_INVALID'
  | 'EMAIL_PIN_EXPIRED'
  | 'EMAIL_PIN_EXHAUSTED'
  | 'EMAIL_PIN_COOLDOWN'
  | 'EMAIL_VERIFICATION_REQUIRED'
  | 'SIGNUP_REJECTED'
  | 'IDENTITY_TOKEN_INVALID'
  | 'IDENTITY_EMAIL_UNVERIFIED'
  | 'SIGNUP_TOKEN_INVALID'
  | 'IDENTITY_ALREADY_LINKED'
  | 'VERIFICATION_RATE_LIMITED'
  | 'VERIFICATION_PHOTOS_REQUIRED'
  | 'VERIFICATION_PHOTOS_CHANGED'
  | 'VERIFICATION_UNAVAILABLE'
  | 'VERIFICATION_CHALLENGE_EXPIRED'
  | 'VERIFICATION_ALREADY_VERIFIED'
  | 'VERIFICATION_IN_REVIEW'
  | 'VERIFICATION_STATE_CONFLICT'
  | 'CONSENT_REQUIRED'
  | 'CONSENT_VERSION_OUTDATED'
  | 'CURRENT_PASSWORD_INVALID'
  | 'CLOSURE_PROOF_REQUIRED'
  | 'ACCOUNT_CLOSURE_STAFF'
  | 'EMAIL_UNCHANGED'
  | 'EMAIL_CHANGE_BLOCKED_BY_SANCTION'
  | 'ACCOUNT_EXPORT_RATE_LIMITED'
  | 'ACCOUNT_EXPORT_NOT_READY'
  | 'ACCOUNT_SUSPENDED'
  | 'ACCOUNT_BANNED'
  | 'STAFF_CLOSURE_SELF'
  | 'STAFF_CLOSURE_NOT_STAFF'
  | 'STAFF_CLOSURE_LAST_ADMIN'
  | 'MODERATOR_NOT_ASSIGNABLE';

/**
 * Error de dominio con `code` estable y `details` opcional (por ejemplo
 * `existingRoutineId`). El filtro global los copia a la respuesta.
 */
export class DomainException extends HttpException {
  constructor(
    status: HttpStatus,
    readonly code: DomainErrorCode,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super({ message, code, ...(details ? { details } : {}) }, status);
  }
}
