import { z } from 'zod';
import { env } from '../../config/env';
import { isAllowedWebPushEndpoint } from './delivery/web-push-endpoint';
import { DevicePlatform } from './device-token.model';

const expoTokenSchema = z
  .string()
  .trim()
  .regex(
    /^Expo(nent)?PushToken\[.+\]$/u,
    'expoPushToken debe tener el formato de un token de Expo.',
  );

/**
 * El `endpoint` que devuelve `PushManager.subscribe()`. Acotado a 500 caracteres
 * porque es lo que cabe en `device_tokens.push_token`, y filtrado contra la
 * allowlist de servicios de push: lo manda el cliente, así que es una URL no
 * confiable (ver `web-push-endpoint.ts`).
 */
const webPushEndpointSchema = z
  .string()
  .trim()
  .url()
  .max(500)
  .refine(
    (endpoint) => isAllowedWebPushEndpoint(endpoint, env.WEB_PUSH_ALLOWED_HOSTS),
    'El endpoint de push no pertenece a un servicio permitido.',
  );

/**
 * Claves de la suscripción (RFC 8291), tal como las serializa el navegador:
 * base64url sin relleno. `p256dh` es un punto P-256 sin comprimir (65 bytes) y
 * `auth` un secreto de 16 bytes; los rangos dejan margen para el relleno y para
 * navegadores que lo añadan, sin admitir una cadena de cualquier longitud.
 */
const base64UrlSchema = (min: number, max: number) =>
  z
    .string()
    .trim()
    .regex(
      new RegExp(`^[A-Za-z0-9_-]{${min},${max}}={0,2}$`, 'u'),
      'La clave debe venir en base64url.',
    );

/**
 * Unión discriminada por plataforma y no un objeto con todo opcional: el móvil
 * manda un token de Expo y el navegador manda endpoint + claves, y son dos
 * cuerpos distintos. Así el contrato del móvil —`{ expoPushToken, platform }`—
 * queda intacto, y el compilador (y Zod) impiden registrar una suscripción web
 * a medias.
 */
export const registerDeviceTokenSchema = z.discriminatedUnion('platform', [
  z.object({
    platform: z.literal(DevicePlatform.ANDROID),
    expoPushToken: expoTokenSchema,
  }),
  z.object({
    platform: z.literal(DevicePlatform.IOS),
    expoPushToken: expoTokenSchema,
  }),
  z.object({
    platform: z.literal(DevicePlatform.WEB),
    endpoint: webPushEndpointSchema,
    keys: z.object({
      p256dh: base64UrlSchema(80, 180),
      auth: base64UrlSchema(16, 60),
    }),
  }),
]);

export type RegisterDeviceTokenInput = z.infer<typeof registerDeviceTokenSchema>;

/**
 * La baja sólo necesita el identificador del destino. Se admiten los dos nombres
 * porque son los que cada cliente conoce: el móvil no tiene un «endpoint» y el
 * navegador no tiene un «expoPushToken».
 */
export const unregisterDeviceTokenSchema = z.union([
  z.object({ expoPushToken: z.string().trim().min(1).max(500) }),
  z.object({ endpoint: z.string().trim().min(1).max(500) }),
]);

export type UnregisterDeviceTokenInput = z.infer<typeof unregisterDeviceTokenSchema>;
