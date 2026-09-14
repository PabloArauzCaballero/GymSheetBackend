import { PushTransport } from './push.transport';
import { VapidWebPushTransport } from './vapid-web-push.transport';

/** Transportes de web push soportados por el selector de configuración. */
export type WebPushTransportName = 'DISABLED' | 'VAPID';

export interface WebPushTransportConfig {
  readonly transport: WebPushTransportName;
  readonly subject?: string;
  readonly publicKey?: string;
  readonly privateKey?: string;
  readonly allowedHosts: readonly string[];
  readonly timeoutMs: number;
  readonly ttlSeconds: number;
}

const REQUIRED_VAPID_FIELDS = ['subject', 'publicKey', 'privateKey'] as const;

const ENVIRONMENT_VARIABLE_BY_FIELD: Record<
  (typeof REQUIRED_VAPID_FIELDS)[number],
  string
> = {
  subject: 'VAPID_SUBJECT',
  publicKey: 'VAPID_PUBLIC_KEY',
  privateKey: 'VAPID_PRIVATE_KEY',
};

/**
 * Selecciona el transporte de web push según la configuración, igual que
 * `createMediaStorageProvider` hace con el almacenamiento. No hay fallback
 * silencioso: pedir `VAPID` sin claves detiene el arranque en vez de dejar el
 * proceso sirviendo altas de suscripciones que van a fallar una a una.
 *
 * `DISABLED` devuelve `null` y eso NO es un fallo: es la forma explícita de
 * decir «este despliegue no hace push al navegador». El despachador se queda sin
 * ruta para la plataforma WEB, y el alta de una suscripción web responde 503 con
 * ese motivo en vez de guardar una fila que nunca sonaría.
 */
export function createWebPushTransport(
  config: WebPushTransportConfig,
): PushTransport | null {
  if (config.transport === 'DISABLED') return null;
  const missing = REQUIRED_VAPID_FIELDS.filter((field) => !config[field]);
  if (missing.length > 0) {
    throw new Error(
      "El transporte de web push 'VAPID' requiere " +
        `${missing.map((field) => ENVIRONMENT_VARIABLE_BY_FIELD[field]).join(', ')}. ` +
        'Genera un par con `npx web-push generate-vapid-keys` o usa WEB_PUSH_TRANSPORT=DISABLED.',
    );
  }
  if (config.allowedHosts.length === 0) {
    throw new Error(
      'WEB_PUSH_ALLOWED_HOSTS está vacío: ningún endpoint de suscripción sería ' +
        'aceptable y el alta fallaría siempre. Declara los servicios de push permitidos.',
    );
  }
  return new VapidWebPushTransport({
    subject: config.subject as string,
    publicKey: config.publicKey as string,
    privateKey: config.privateKey as string,
    allowedHosts: config.allowedHosts,
    timeoutMs: config.timeoutMs,
    ttlSeconds: config.ttlSeconds,
  });
}
