import { DevicePlatform } from '../device-token.model';

/**
 * Puerto de salida para el empujón a un dispositivo (ports & adapters, igual que
 * `MailTransport` y `MediaStorageProvider`).
 *
 * Es más estrecho que `NotificationDeliveryAdapter`: aquél habla de canales del
 * dominio y de usuarios; éste sólo de destinos concretos y de un título con un
 * cuerpo. Esa frontera es la que permite que convivan Expo (que reenvía a
 * FCM/APNs) y Web Push con VAPID sin que el caso de uso se entere de ninguno de
 * los dos.
 *
 * ## Por qué `send` recibe una LISTA y no un destino
 *
 * Porque los transportes no cuestan lo mismo por destino. Expo acepta cien
 * tokens en una sola petición; Web Push exige una petición HTTP por navegador,
 * porque cada cuerpo va cifrado con las claves de ESA suscripción. Un puerto de
 * un destino por llamada habría convertido el lote de Expo en cien peticiones
 * para que el adaptador más caro no se notara.
 */
export interface PushMessage {
  readonly title: string | null;
  readonly body: string;
  /**
   * Ruta relativa que debe abrirse al pulsar el aviso (p. ej. `/notifications`).
   * Relativa a propósito: el mismo aviso vale para cualquier host del portal, y
   * es el service worker quien la resuelve contra su propio origen.
   */
  readonly url: string | null;
}

/** Un destino ya materializado desde `device_tokens`. */
export interface PushTarget {
  readonly id: string;
  readonly platform: DevicePlatform;
  /** `ExponentPushToken[...]` en móvil; URL del endpoint de la suscripción en web. */
  readonly pushToken: string;
  /** Claves RFC 8291; sólo llegan con `platform = WEB`. */
  readonly p256dh: string | null;
  readonly auth: string | null;
}

/**
 * Qué pasó con un destino.
 *
 * `GONE` es el único que obliga a actuar sobre la base: el destino dejó de
 * existir (app desinstalada, suscripción revocada desde el navegador) y
 * reintentar contra él es reintentar para siempre contra nada. `FAILED` es
 * transitorio y se queda en el registro: la notificación in-app, que es la
 * fuente de verdad, ya está guardada.
 */
export type PushDeliveryStatus = 'DELIVERED' | 'FAILED' | 'GONE';

export interface PushDeliveryOutcome {
  readonly targetId: string;
  readonly status: PushDeliveryStatus;
}

export interface PushTransport {
  /** Identificador para los registros: `EXPO`, `WEB_PUSH`… */
  readonly name: string;
  /**
   * Plataformas que este transporte sabe alcanzar. El despachador construye con
   * esto su tabla de rutas, de modo que el transporte se elige por la plataforma
   * DEL DESTINO y nunca por una configuración global: un mismo usuario tiene el
   * teléfono y el navegador a la vez, y ambos deben sonar.
   */
  readonly platforms: readonly DevicePlatform[];
  send(
    targets: readonly PushTarget[],
    message: PushMessage,
  ): Promise<readonly PushDeliveryOutcome[]>;
}

/** Token de inyección: la interfaz sola no existe en tiempo de ejecución. */
export const PUSH_TRANSPORTS = Symbol('PUSH_TRANSPORTS');
