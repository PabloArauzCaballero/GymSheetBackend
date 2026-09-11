import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Op } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import { randomInt } from 'node:crypto';
import * as bcrypt from 'bcryptjs';
import { NotificationChannel, RefreshTokenRevokedReason } from '../../common/enums/domain.enums';
import { env } from '../../config/env';
import { UsersRepository } from '../users/users.repository';
import { NotificationService } from '../notifications/notification.service';
import { PasswordResetTokenModel } from './password-reset-token.model';
import { RefreshTokenRepository } from './refresh-token.repository';

/**
 * Recuperación de contraseña por PIN enviado al correo.
 *
 * Tres decisiones gobiernan todo lo de abajo:
 *
 * **La respuesta no revela si la cuenta existe.** Pedir un PIN devuelve lo
 * mismo para un correo registrado y para uno que no. Un formulario de «olvidé
 * mi contraseña» que distingue ambos casos es un comprobador de cuentas
 * gratuito para cualquiera, y el correo de una persona no es información que
 * este endpoint deba confirmar a un desconocido.
 *
 * **El PIN es una credencial de vida corta.** Se guarda hasheado, caduca en
 * minutos, se gasta al usarse y se quema tras unos pocos fallos. Seis cifras
 * son un millón de combinaciones: sin límite de intentos, un script las agota
 * en el tiempo que dura un café.
 *
 * **Pedir uno nuevo invalida el anterior.** Si no, cada solicitud dejaría otro
 * código vivo y la ventana de ataque crecería con la impaciencia del usuario,
 * que es exactamente al revés de lo que debe pasar.
 */
@Injectable()
export class PasswordResetService {
  private readonly logger = new Logger(PasswordResetService.name);

  constructor(
    @InjectModel(PasswordResetTokenModel)
    private readonly tokens: typeof PasswordResetTokenModel,
    private readonly users: UsersRepository,
    private readonly notifications: NotificationService,
    private readonly refreshTokens: RefreshTokenRepository,
    private readonly sequelize: Sequelize,
  ) {}

  /**
   * Genera un PIN y lo manda por correo.
   *
   * Devuelve siempre lo mismo, exista la cuenta o no. Lo único que cambia es lo
   * que ocurre por dentro.
   */
  async requestPin(emailAddress: string, requesterIp: string | null): Promise<void> {
    const user = await this.users.findActiveByEmail(emailAddress);
    if (!user) {
      // Ni se registra el correo consultado: eso convertiría el registro en la
      // lista de direcciones que alguien estuvo sondeando.
      this.logger.log('Password reset requested for a non-matching account.');
      return;
    }

    // `randomInt` y no `Math.random()`: esto es una credencial, y el generador
    // por defecto es predecible a partir de suficientes muestras.
    const pin = String(randomInt(0, 1_000_000)).padStart(6, '0');
    const pinHash = await bcrypt.hash(pin, env.BCRYPT_SALT_ROUNDS);
    const expiraEn = new Date(Date.now() + env.PASSWORD_RESET_PIN_TTL_MINUTES * 60_000);

    await this.sequelize.transaction(async (transaction) => {
      // Los pendientes anteriores mueren aquí, dentro de la misma transacción
      // que crea el nuevo: entre ambos instantes no debe haber dos códigos
      // válidos para la misma cuenta.
      await this.tokens.update(
        { consumidoEn: new Date() },
        { where: { usuarioId: user.id, consumidoEn: null }, transaction },
      );
      await this.tokens.create(
        {
          usuarioId: user.id,
          pinHash,
          expiraEn,
          consumidoEn: null,
          intentos: 0,
          solicitadoDesdeIp: requesterIp,
        },
        { transaction },
      );
    });

    const minutos = env.PASSWORD_RESET_PIN_TTL_MINUTES;
    await this.notifications.enqueueDirectMessage({
      recipientUserId: user.id,
      channel: NotificationChannel.EMAIL,
      subject: 'Tu código para restablecer la contraseña',
      body: [
        `Tu código es ${pin}`,
        '',
        `Caduca en ${minutos} ${minutos === 1 ? 'minuto' : 'minutos'} y sólo sirve una vez.`,
        '',
        'Si no lo pediste tú, ignora este mensaje: tu contraseña sigue siendo la misma.',
      ].join('\n'),
      deduplicationKey: `password-reset-${user.id}-${expiraEn.getTime()}`,
    });
  }

  /**
   * Comprueba el PIN y establece la nueva contraseña.
   *
   * El error es el mismo para un PIN equivocado, uno caducado y uno ya usado.
   * Distinguirlos le diría a quien prueba códigos si va por buen camino.
   */
  async confirm(emailAddress: string, pin: string, newPassword: string): Promise<void> {
    const invalid = new BadRequestException('El código no es válido o ha caducado.');
    const user = await this.users.findActiveByEmail(emailAddress);
    if (!user) throw invalid;

    const token = await this.tokens.findOne({
      where: {
        usuarioId: user.id,
        consumidoEn: null,
        expiraEn: { [Op.gt]: new Date() },
      },
      order: [['created_at', 'DESC']],
    });
    if (!token) throw invalid;

    if (token.intentos >= env.PASSWORD_RESET_MAX_ATTEMPTS) {
      // Quemarlo aquí y no sólo rechazarlo: un token que ya agotó sus intentos
      // no debe seguir vivo esperando al siguiente intento.
      await token.update({ consumidoEn: new Date() });
      throw invalid;
    }

    const matches = await bcrypt.compare(pin, token.pinHash);
    if (!matches) {
      await token.increment('intentos');
      throw invalid;
    }

    const passwordHash = await bcrypt.hash(newPassword, env.BCRYPT_SALT_ROUNDS);
    await this.sequelize.transaction(async (transaction) => {
      await this.users.updatePasswordHash(user.id, passwordHash, transaction);
      await token.update({ consumidoEn: new Date() }, { transaction });
      // Restablecer la contraseña cierra todas las sesiones abiertas. Es el
      // motivo por el que se restablece tras una sospecha de robo: dejar vivos
      // los refresh tokens de quien entró convertiría el cambio en un gesto.
      await this.refreshTokens.revokeAllForUser(
        user.id,
        RefreshTokenRevokedReason.PASSWORD_RESET,
        transaction,
      );
    });

    // Aviso posterior al cambio, no una cortesía: es lo único que le dice a la
    // persona que alguien entró en su cuenta si no fue ella.
    await this.notifications.enqueueDirectMessage({
      recipientUserId: user.id,
      channel: NotificationChannel.EMAIL,
      subject: 'Tu contraseña de GymSheet ha cambiado',
      body: [
        'Acabas de establecer una contraseña nueva.',
        '',
        'Si no fuiste tú, escribe a tu gimnasio cuanto antes: alguien más tiene acceso a tu correo.',
      ].join('\n'),
      deduplicationKey: `password-changed-${user.id}-${Date.now()}`,
    });
  }
}
