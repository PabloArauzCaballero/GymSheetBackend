import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Op } from 'sequelize';
import { DevicePlatform } from '../../common/enums/domain.enums';
import { DeviceTokenModel } from './device-token.model';

@Injectable()
export class DeviceTokenRepository {
  constructor(
    @InjectModel(DeviceTokenModel)
    private readonly tokens: typeof DeviceTokenModel,
  ) {}

  /**
   * Alta idempotente: la app pide el token en cada arranque y lo manda igual,
   * así que esto se ejecuta muchas más veces de las que hay dispositivos
   * nuevos. Si el token ya existía se actualiza —incluido el `userId`, porque
   * un mismo teléfono puede cambiar de dueño o de cuenta— y se resucita si
   * estaba revocado: el dispositivo acaba de demostrar que sigue vivo.
   */
  async register(input: {
    userId: string;
    expoPushToken: string;
    platform: DevicePlatform;
  }): Promise<DeviceTokenModel> {
    const existing = await this.tokens.findOne({
      where: { expoPushToken: input.expoPushToken },
    });
    if (existing) {
      await existing.update({
        userId: input.userId,
        platform: input.platform,
        revokedAt: null,
        lastRegisteredAt: new Date(),
      });
      return existing;
    }
    return this.tokens.create({
      userId: input.userId,
      expoPushToken: input.expoPushToken,
      platform: input.platform,
      revokedAt: null,
      lastRegisteredAt: new Date(),
      metadata: {},
    });
  }

  /**
   * La baja exige que el token sea de quien la pide: sin esa condición
   * cualquiera con sesión podría silenciar el teléfono ajeno mandando un token
   * que no es suyo. Devuelve cuántas filas cambió para que la capa de arriba
   * distinga "dado de baja" de "no era tuyo o no existía".
   */
  async revoke(userId: string, expoPushToken: string): Promise<number> {
    const [affected] = await this.tokens.update(
      { revokedAt: new Date() },
      { where: { userId, expoPushToken, revokedAt: { [Op.is]: null } } },
    );
    return affected;
  }

  listActiveForUser(userId: string): Promise<DeviceTokenModel[]> {
    return this.tokens.findAll({
      where: { userId, revokedAt: { [Op.is]: null } },
      order: [['lastRegisteredAt', 'DESC']],
    });
  }

  /**
   * Retira los tokens que el propio Expo declaró muertos (`DeviceNotRegistered`).
   * No los borra: mantener la fila evita que el siguiente arranque de esa app
   * —que ya no existe— vuelva a crear una entrada limpia.
   */
  async revokeTokens(expoPushTokens: readonly string[]): Promise<number> {
    if (expoPushTokens.length === 0) return 0;
    const [affected] = await this.tokens.update(
      { revokedAt: new Date() },
      {
        where: {
          expoPushToken: { [Op.in]: [...expoPushTokens] },
          revokedAt: { [Op.is]: null },
        },
      },
    );
    return affected;
  }
}
