import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { DevicePlatform, DeviceTokenModel } from './device-token.model';

@Injectable()
export class DeviceTokenRepository {
  constructor(
    @InjectModel(DeviceTokenModel)
    private readonly model: typeof DeviceTokenModel,
  ) {}

  /**
   * Un token de Expo identifica un DISPOSITIVO, no una cuenta: si el mismo teléfono cambió de
   * usuario (cerró sesión y entró con otra cuenta), el UNIQUE de `expo_push_token` obliga a
   * reasignar el dueño en vez de duplicar la fila. `active` vuelve a `true` porque un registro
   * nuevo significa que la app volvió a pedir permiso y a confirmar el token con éxito.
   */
  async upsert(userId: string, platform: DevicePlatform, expoPushToken: string): Promise<void> {
    const [row] = await this.model.findOrCreate({
      where: { expoPushToken },
      defaults: { userId, platform, expoPushToken, active: true, lastSeenAt: new Date() },
    });
    await row.update({ userId, platform, active: true, lastSeenAt: new Date() });
  }

  async deactivate(userId: string, expoPushToken: string): Promise<void> {
    await this.model.update(
      { active: false },
      { where: { userId, expoPushToken } },
    );
  }

  /** Tokens activos de un usuario, para el fan-out de una notificación real. */
  async findActiveTokens(userId: string): Promise<string[]> {
    const rows = await this.model.findAll({
      where: { userId, active: true },
      attributes: ['expoPushToken'],
    });
    return rows.map((row) => row.expoPushToken);
  }

  /**
   * Expo devuelve `DeviceNotRegistered` por token cuando la app se desinstaló o el token
   * caducó. Desactivarlo evita reintentar para siempre contra un destino muerto.
   */
  async deactivateByToken(expoPushToken: string): Promise<void> {
    await this.model.update({ active: false }, { where: { expoPushToken } });
  }
}
