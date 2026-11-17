import { Injectable, Logger } from '@nestjs/common';
import { Transaction } from 'sequelize';
import { NotificationChannel } from '../../common/enums/domain.enums';
import { NotificationService } from '../notifications/notification.service';
import { AffiliationKind, GymReason, REASON_TEXT } from './affiliation.catalog';

export type AffiliationNotice =
  | { event: 'REQUESTED'; subject: 'PERSON' | 'COACH' }
  | { event: 'CONFIRMED'; gymName: string }
  | { event: 'REJECTED'; gymName: string; reason: GymReason; note: string | null }
  | { event: 'ENDED'; gymName: string; reason: GymReason | 'SWITCHED_GYM'; note: string | null };

const ROLE: Record<AffiliationKind, string> = { SOCIO: 'socio', ENTRENADOR: 'entrenador' };

/** The texts never name the person to anyone else: the gym's notice only says a request arrived. */
function render(kind: AffiliationKind, notice: AffiliationNotice): { subject: string; body: string } {
  switch (notice.event) {
    case 'REQUESTED':
      return notice.subject === 'COACH'
        ? { subject: 'Un coach quiere vincularse', body: 'Un coach pidió figurar como entrenador de tu gimnasio. Revísalo en Socios.' }
        : { subject: `Nueva solicitud de ${ROLE[kind]}`, body: `Alguien dice ser ${ROLE[kind]} de tu gimnasio. Confírmalo o recházalo en Socios.` };
    case 'CONFIRMED':
      return { subject: `Ya eres ${ROLE[kind]} de ${notice.gymName}`, body: `${notice.gymName} confirmó tu afiliación como ${ROLE[kind]}.` };
    case 'REJECTED':
      return {
        subject: `Solicitud no confirmada · ${notice.gymName}`,
        body: `${REASON_TEXT[notice.reason]}${notice.note ? ` «${notice.note}».` : ''} Si crees que es un error, habla con el gimnasio.`,
      };
    case 'ENDED':
      return notice.reason === 'SWITCHED_GYM'
        ? { subject: `Dejaste de ser socio de ${notice.gymName}`, body: 'Tu nuevo gimnasio confirmó tu cambio, así que terminamos la afiliación anterior.' }
        : {
            subject: `Afiliación terminada · ${notice.gymName}`,
            body: `${REASON_TEXT[notice.reason]}${notice.note ? ` «${notice.note}».` : ''}`,
          };
  }
}

/** In-app notices of the affiliations (plan §2.12). A notice that fails never undoes the change it reports. */
@Injectable()
export class AffiliationNotices {
  private readonly logger = new Logger(AffiliationNotices.name);

  constructor(private readonly notifications: NotificationService) {}

  async send(recipientUserId: string, affiliation: { id: string; kind: AffiliationKind }, notice: AffiliationNotice, transaction: Transaction): Promise<void> {
    const { subject, body } = render(affiliation.kind, notice);
    try {
      // Its own savepoint (inside the service): a failure rolls back the notice only.
      await this.notifications.enqueueDirectMessage(
        {
          recipientUserId,
          channel: NotificationChannel.IN_APP,
          subject,
          body,
          deduplicationKey: `affiliation:${affiliation.id}:${notice.event.toLowerCase()}`,
          metadata: { kind: 'AFFILIATION', event: notice.event, affiliationId: affiliation.id },
        },
        transaction,
      );
    } catch (error: unknown) {
      this.logger.warn({ event: 'affiliation.notice_failed', notice: notice.event, errorName: error instanceof Error ? error.name : 'UnknownError' });
    }
  }
}
