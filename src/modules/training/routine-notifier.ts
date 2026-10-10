import { Injectable } from '@nestjs/common';
import { NotificationChannel } from '../../common/enums/domain.enums';
import { NotificationService } from '../notifications/notification.service';

export type RoutineNotificationType =
  | 'ROUTINE_SHARE_INVITE'
  | 'ROUTINE_SHARE_ACCEPTED'
  | 'ROUTINE_SHARE_DECLINED'
  | 'ROUTINE_NEW_VERSION'
  | 'ROUTINE_COMMENT'
  | 'CONTENT_HIDDEN'
  | 'GOAL_REACHED'
  | 'PROGRAM_WEEK_CLOSED'
  | 'PROGRAM_FINISHED';

/**
 * Avisos del dominio de rutinas por la bandeja interna (con empujón al móvil).
 * `type` y `refs` viajan en `metadata` para que el cliente sepa a dónde abrir;
 * `dedupeKey` evita duplicados (p. ej. una versión nueva se avisa una vez al día).
 */
@Injectable()
export class RoutineNotifier {
  constructor(private readonly notifications: NotificationService) {}

  notify(input: {
    to: string;
    type: RoutineNotificationType;
    subject: string;
    body: string;
    dedupeKey: string;
    refs: Record<string, string | number | null>;
  }): Promise<boolean> {
    return this.notifications.enqueueDirectMessage({
      recipientUserId: input.to,
      channel: NotificationChannel.IN_APP,
      subject: input.subject,
      body: input.body,
      deduplicationKey: `${input.type}:${input.dedupeKey}`.slice(0, 240),
      metadata: { type: input.type, refs: input.refs },
    });
  }
}
