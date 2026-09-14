import { Inject, Injectable, Logger } from '@nestjs/common';
import { DevicePlatform } from '../device-token.model';
import { DeviceTokenRepository } from '../device-token.repository';
import {
  PUSH_TRANSPORTS,
  PushMessage,
  PushTarget,
  PushTransport,
} from './push.transport';

export type PushDispatchResult = {
  /** Destinos que el transporte dio por entregados. */
  readonly delivered: number;
  /** Destinos dados de baja porque el servicio de push dijo que ya no existen. */
  readonly deactivated: number;
  /** Destinos sin transporte registrado para su plataforma. */
  readonly skipped: number;
};

/**
 * Reparte una notificación entre los dispositivos de un usuario.
 *
 * La decisión que vive aquí, y en ningún otro sitio, es **por dónde sale cada
 * destino**: se elige transporte por la plataforma DE LA FILA, no por una
 * variable de entorno global. La diferencia importa porque el caso normal es una
 * persona con el móvil y el navegador a la vez: una elección global apagaría uno
 * de los dos.
 *
 * Best-effort en su conjunto: el aviso in-app ya está guardado y es la fuente de
 * verdad, así que ningún fallo de aquí se propaga al caso de uso.
 */
@Injectable()
export class PushDispatcherService {
  private readonly logger = new Logger('PushDispatcherService');
  private readonly routes = new Map<DevicePlatform, PushTransport>();

  constructor(
    @Inject(PUSH_TRANSPORTS) transports: readonly PushTransport[],
    private readonly deviceTokens: DeviceTokenRepository,
  ) {
    for (const transport of transports) {
      for (const platform of transport.platforms) {
        const existing = this.routes.get(platform);
        if (existing) {
          // Dos transportes para la misma plataforma no es una preferencia: es
          // una configuración ambigua, y resolverla en silencio significaría que
          // nadie sabe por dónde salieron los avisos.
          throw new Error(
            `Dos transportes de push reclaman la plataforma ${platform}: ` +
              `${existing.name} y ${transport.name}.`,
          );
        }
        this.routes.set(platform, transport);
      }
    }
  }

  /** Si la plataforma tiene transporte, y por tanto si tiene sentido registrarla. */
  supports(platform: DevicePlatform): boolean {
    return this.routes.has(platform);
  }

  async sendToUser(userId: string, message: PushMessage): Promise<PushDispatchResult> {
    const targets = await this.deviceTokens.findActiveTargets(userId);
    if (targets.length === 0) return { delivered: 0, deactivated: 0, skipped: 0 };

    const byTransport = new Map<PushTransport, PushTarget[]>();
    let skipped = 0;
    for (const target of targets) {
      const transport = this.routes.get(target.platform);
      if (!transport) {
        skipped += 1;
        continue;
      }
      const group = byTransport.get(transport);
      if (group) group.push(target);
      else byTransport.set(transport, [target]);
    }

    let delivered = 0;
    let deactivated = 0;
    for (const [transport, group] of byTransport) {
      const outcomes = await transport.send(group, message);
      for (const outcome of outcomes) {
        if (outcome.status === 'DELIVERED') delivered += 1;
        if (outcome.status === 'GONE') {
          await this.deviceTokens.deactivateById(outcome.targetId);
          deactivated += 1;
        }
      }
    }

    if (skipped > 0) {
      this.logger.debug({ event: 'push.targets_without_transport', skipped });
    }
    return { delivered, deactivated, skipped };
  }
}
