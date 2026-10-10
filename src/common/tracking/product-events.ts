import { Injectable, Logger } from '@nestjs/common';

/**
 * Eventos de producto emitidos por el backend (07_BACKOFFICE §Tracking).
 * Salen como logs estructurados `event: product.<nombre>` que el pipeline de
 * logs agrega; solo llevan identificadores y números, nunca nombres, correos
 * ni texto de comentarios (privacidad).
 */
export type ProductEventName =
  | 'routine_created'
  | 'routine_published'
  | 'routine_publish_blocked_duplicate'
  | 'routine_copied'
  | 'routine_share_invited'
  | 'routine_share_accepted'
  | 'routine_share_declined'
  | 'program_activated'
  | 'program_week_closed'
  | 'overload_load_changed'
  | 'strength_goal_reached'
  | 'cardio_session_logged';

@Injectable()
export class ProductEvents {
  private readonly logger = new Logger('ProductEvents');

  emit(name: ProductEventName, properties: Record<string, string | number | boolean | null>): void {
    this.logger.log({ event: `product.${name}`, ...properties });
  }
}
