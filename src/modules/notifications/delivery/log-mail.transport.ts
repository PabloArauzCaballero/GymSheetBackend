import { Injectable, Logger } from '@nestjs/common';
import {
  MailDeliveryResult,
  MailMessage,
  MailTransport,
} from './mail.transport';

/**
 * Transporte de desarrollo: no envía nada, lo escribe en el registro.
 *
 * Existe para que el flujo de recuperación se pueda recorrer entero sin un
 * servidor SMTP delante. Sin él, la única forma de probar «olvidé mi
 * contraseña» en local sería configurar un buzón real, y lo que acaba pasando
 * entonces es que nadie lo prueba.
 *
 * Escribe el cuerpo completo, PIN incluido. Eso es exactamente lo que no debe
 * ocurrir fuera de desarrollo, y por eso `env` prohíbe seleccionar este
 * transporte en producción: un PIN en los registros es una credencial en los
 * registros.
 */
@Injectable()
export class LogMailTransport implements MailTransport {
  private readonly logger = new Logger(LogMailTransport.name);

  async send(message: MailMessage): Promise<MailDeliveryResult> {
    this.logger.log(
      [
        '',
        '──────── correo (transporte de registro) ────────',
        `Para:    ${message.to}`,
        `Asunto:  ${message.subject}`,
        '',
        message.text,
        '────────────────────────────────────────────────',
      ].join('\n'),
    );
    return { provider: 'LOG', messageId: message.idempotencyKey };
  }
}
