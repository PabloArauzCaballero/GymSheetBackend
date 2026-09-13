import { z } from 'zod';
import { DevicePlatform } from './device-token.model';

export const registerDeviceTokenSchema = z.object({
  expoPushToken: z
    .string()
    .trim()
    .regex(
      /^Expo(nent)?PushToken\[.+\]$/u,
      'expoPushToken debe tener el formato de un token de Expo.',
    ),
  platform: z.nativeEnum(DevicePlatform),
});

export type RegisterDeviceTokenInput = z.infer<typeof registerDeviceTokenSchema>;

export const unregisterDeviceTokenSchema = z.object({
  expoPushToken: z.string().trim().min(1),
});

export type UnregisterDeviceTokenInput = z.infer<typeof unregisterDeviceTokenSchema>;
