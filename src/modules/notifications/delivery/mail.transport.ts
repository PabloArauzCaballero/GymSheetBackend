/**
 * Puerto de salida para el correo.
 *
 * Deliberadamente más estrecho que `NotificationDeliveryAdapter`: aquél habla
 * de destinatarios como usuarios del dominio, y éste sólo de direcciones y
 * texto. Esa frontera es la que permite que el adaptador de correo traduzca
 * una vez —usuario a dirección, mensaje a asunto y cuerpo— y que por debajo se
 * pueda cambiar SMTP por un proveedor de API sin que nada del dominio se entere.
 *
 * No hay adjuntos ni plantillas aquí a propósito. Cuando hagan falta serán una
 * decisión con su propio diseño, no una opción más colgada de esta interfaz.
 */
export interface MailMessage {
  readonly to: string;
  readonly subject: string;
  /** Cuerpo en texto plano. Es el que se garantiza legible en todo cliente. */
  readonly text: string;
  /** Cuerpo en HTML, opcional. Un cliente que no pueda con él usa `text`. */
  readonly html?: string;
  /**
   * Identificador estable del envío. El transporte lo propaga como cabecera
   * para que un reintento no produzca dos correos donde el usuario esperaba
   * uno solo.
   */
  readonly idempotencyKey: string;
}

export interface MailDeliveryResult {
  /** Quién lo entregó de verdad: `SMTP`, `LOG`… Va al registro de intentos. */
  readonly provider: string;
  /** Identificador que devuelve el proveedor, si lo devuelve. */
  readonly messageId: string | null;
}

export interface MailTransport {
  send(message: MailMessage): Promise<MailDeliveryResult>;
}

/** Token de inyección: la interfaz sola no existe en tiempo de ejecución. */
export const MAIL_TRANSPORT = Symbol('MAIL_TRANSPORT');
