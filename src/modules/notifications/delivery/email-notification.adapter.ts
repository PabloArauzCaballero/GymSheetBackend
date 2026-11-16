import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { UserModel } from '../../users/user.model';
import {
  NotificationDeliveryAdapter,
  NotificationDeliveryRequest,
  NotificationDeliveryResult,
} from './notification-delivery.adapter';
import { MAIL_TRANSPORT, MailTransport } from './mail.transport';

/**
 * El correo, dentro del mismo hexágono que el resto de la mensajería.
 *
 * Implementa el puerto de entrega que ya usaban el canal in-app y la pasarela
 * HTTP, así que para el servicio de entrega mandar un correo y guardar un aviso
 * en la app son la misma operación con otro adaptador detrás. Ese es el punto
 * de tener un puerto: añadir un medio no cambia ni una línea del caso de uso.
 *
 * Aquí ocurre la única traducción que el dominio no debe conocer: de usuario a
 * dirección de correo. El dominio habla de a quién avisa; el transporte, de a
 * qué buzón escribe.
 */
@Injectable()
export class EmailNotificationAdapter implements NotificationDeliveryAdapter {
  constructor(@Inject(MAIL_TRANSPORT) private readonly transport: MailTransport) {}

  async deliver(request: NotificationDeliveryRequest): Promise<NotificationDeliveryResult> {
    // An explicit mailbox (the new address of an email change, or the old one
    // being told about it) wins over the account's current address.
    const recipientEmail = request.recipientEmail ?? (await this.accountEmail(request.recipientUserId));
    // Un mensaje encolado para alguien que ya no existe no es un fallo
    // transitorio: reintentarlo no lo va a arreglar nunca, y por eso se
    // distingue de un error de red.
    if (!recipientEmail) {
      throw new NotFoundException('The recipient has no email address.');
    }

    const result = await this.transport.send({
      to: recipientEmail,
      // Un correo sin asunto acaba en spam y, antes de eso, es ilegible en una
      // bandeja de entrada. Si el mensaje no traía uno, se pone el de la marca.
      subject: request.subject ?? 'GymSheet',
      text: request.body,
      idempotencyKey: request.idempotencyKey,
    });

    return {
      provider: `EMAIL_${result.provider}`,
      providerMessageId: result.messageId,
      responseCode: 'SENT',
    };
  }

  private async accountEmail(userId: string): Promise<string | null> {
    const recipient = await UserModel.findByPk(userId, { attributes: ['id', 'email'] });
    return recipient?.email ?? null;
  }
}
