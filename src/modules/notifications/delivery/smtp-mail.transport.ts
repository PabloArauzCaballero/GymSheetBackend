import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { createTransport, type Transporter } from 'nodemailer';
import { env } from '../../../config/env';
import {
  MailDeliveryResult,
  MailMessage,
  MailTransport,
} from './mail.transport';

/** Extrae el identificador del proveedor, si vino y si es una cadena. */
function readMessageId(result: unknown): string | null {
  if (typeof result !== 'object' || result === null) return null;
  const messageId = (result as { messageId?: unknown }).messageId;
  return typeof messageId === 'string' ? messageId : null;
}

/**
 * Transporte SMTP real.
 *
 * El `Transporter` se crea una sola vez y se reutiliza: nodemailer mantiene un
 * grupo de conexiones, y crear uno por correo significa pagar la negociación
 * TLS en cada envío —lo caro de mandar un correo no es el correo—.
 *
 * Se construye de forma perezosa en vez de en el constructor porque este
 * proveedor puede no estar configurado: la app arranca igual con el transporte
 * de registro, y sólo quien pide SMTP debe encontrarse con el error de que
 * falta configuración.
 */
@Injectable()
export class SmtpMailTransport implements MailTransport {
  private readonly logger = new Logger(SmtpMailTransport.name);
  private transporter: Transporter | null = null;

  private resolveTransporter(): Transporter {
    if (this.transporter) return this.transporter;
    if (!env.MAIL_SMTP_HOST || !env.MAIL_FROM) {
      throw new ServiceUnavailableException('SMTP mail transport is not configured.');
    }
    this.transporter = createTransport({
      host: env.MAIL_SMTP_HOST,
      port: env.MAIL_SMTP_PORT,
      // `secure` es TLS desde el saludo, propio del 465. En el 587 se empieza
      // en claro y se sube con STARTTLS, que es lo que hace nodemailer solo.
      secure: env.MAIL_SMTP_PORT === 465,
      auth:
        env.MAIL_SMTP_USER && env.MAIL_SMTP_PASSWORD
          ? { user: env.MAIL_SMTP_USER, pass: env.MAIL_SMTP_PASSWORD }
          : undefined,
      // Un servidor que no responde no debe dejar colgada la petición del
      // usuario: el caso de uso decide qué contar, pero necesita que esto
      // termine.
      connectionTimeout: env.MAIL_SMTP_TIMEOUT_MS,
      greetingTimeout: env.MAIL_SMTP_TIMEOUT_MS,
      socketTimeout: env.MAIL_SMTP_TIMEOUT_MS,
    });
    return this.transporter;
  }

  async send(message: MailMessage): Promise<MailDeliveryResult> {
    const transporter = this.resolveTransporter();
    try {
      // `sendMail` está declarado como `SentMessageInfo`, que en los tipos
      // publicados es `any`. Se recibe como `unknown` y se estrecha: la regla
      // de tipado del proyecto prohíbe propagar `any`, y aquí además el valor
      // viene de una librería cuyo contrato exacto depende del servidor SMTP
      // que haya respondido.
      const result: unknown = await transporter.sendMail({
        from: env.MAIL_FROM,
        to: message.to,
        subject: message.subject,
        text: message.text,
        html: message.html,
        headers: { 'X-Idempotency-Key': message.idempotencyKey },
      });
      return { provider: 'SMTP', messageId: readMessageId(result) };
    } catch (error) {
      // Nunca se registra el cuerpo: lleva el PIN. Sólo el destinatario y el
      // motivo, que es lo que hace falta para diagnosticar un envío fallido.
      this.logger.error(
        `SMTP delivery failed for ${message.to}: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      );
      throw new ServiceUnavailableException('The email could not be delivered.');
    }
  }
}
