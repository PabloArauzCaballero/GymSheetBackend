import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { DevicePlatform, DeviceTokenModel } from './device-token.model';
import { PushTarget } from './delivery/push.transport';

/** Lo que necesita una fila para existir; las claves sólo llegan desde WEB. */
export type DeviceTokenUpsert = {
  readonly platform: DevicePlatform;
  readonly pushToken: string;
  readonly p256dh: string | null;
  readonly auth: string | null;
};

@Injectable()
export class DeviceTokenRepository {
  constructor(
    @InjectModel(DeviceTokenModel)
    private readonly model: typeof DeviceTokenModel,
  ) {}

  /**
   * Un token de push identifica un DESTINO, no una cuenta: si el mismo teléfono
   * —o el mismo navegador— cambió de usuario (cerró sesión y entró con otra
   * cuenta), el UNIQUE de `push_token` obliga a reasignar el dueño en vez de
   * duplicar la fila. `active` vuelve a `true` porque un registro nuevo
   * significa que el cliente volvió a pedir permiso y a confirmar el destino.
   *
   * Las claves se reescriben en cada registro porque el navegador las rota:
   * cuando el servicio de push renueva una suscripción, el `endpoint` puede
   * seguir siendo el mismo y `p256dh`/`auth` no. Guardar las viejas produce
   * cuerpos que el navegador no puede descifrar, que es un fallo silencioso.
   */
  async upsert(userId: string, input: DeviceTokenUpsert): Promise<void> {
    const [row] = await this.model.findOrCreate({
      where: { pushToken: input.pushToken },
      defaults: {
        userId,
        platform: input.platform,
        pushToken: input.pushToken,
        p256dh: input.p256dh,
        auth: input.auth,
        active: true,
        lastSeenAt: new Date(),
      },
    });
    await row.update({
      userId,
      platform: input.platform,
      p256dh: input.p256dh,
      auth: input.auth,
      active: true,
      lastSeenAt: new Date(),
    });
  }

  async deactivate(userId: string, pushToken: string): Promise<void> {
    await this.model.update({ active: false }, { where: { userId, pushToken } });
  }

  /**
   * Destinos activos de un usuario, para el fan-out de una notificación real.
   * Devuelve la plataforma y las claves, no sólo la cadena: el despachador elige
   * transporte por la plataforma de CADA destino, y el de web necesita además
   * las claves para cifrar.
   */
  async findActiveTargets(userId: string): Promise<PushTarget[]> {
    const rows = await this.model.findAll({
      where: { userId, active: true },
      attributes: ['id', 'platform', 'pushToken', 'p256dh', 'auth'],
    });
    return rows.map((row) => ({
      id: row.id,
      platform: row.platform,
      pushToken: row.pushToken,
      p256dh: row.p256dh,
      auth: row.auth,
    }));
  }

  /**
   * El servicio de push dice que el destino ya no existe (`DeviceNotRegistered`
   * en Expo, 404/410 en Web Push): la app se desinstaló o el usuario revocó el
   * permiso. Desactivarlo evita reintentar para siempre contra un destino
   * muerto. Se desactiva por `id` y no por la cadena porque el `id` es lo que el
   * transporte devuelve en su resultado.
   */
  async deactivateById(id: string): Promise<void> {
    await this.model.update({ active: false }, { where: { id } });
  }
}
