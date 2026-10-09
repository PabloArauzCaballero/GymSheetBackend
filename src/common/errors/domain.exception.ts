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
  | 'CONTENT_HIDDEN';

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
