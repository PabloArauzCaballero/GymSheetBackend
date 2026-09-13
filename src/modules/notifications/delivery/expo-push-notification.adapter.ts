import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { z } from 'zod';
import { env } from '../../../config/env';
import { DeviceTokenRepository } from '../device-token.repository';
import {
  NotificationDeliveryAdapter,
  NotificationDeliveryRequest,
  NotificationDeliveryResult,
} from './notification-delivery.adapter';

/** Tope documentado por Expo: como máximo 100 mensajes por petición. */
const MAX_MESSAGES_PER_REQUEST = 100;

const pushTicketSchema = z.union([
  z.object({ status: z.literal('ok'), id: z.string().optional() }),
  z.object({
    status: z.literal('error'),
    message: z.string().optional(),
    details: z.object({ error: z.string().optional() }).partial().optional(),
  }),
]);

const pushResponseSchema = z.object({
  data: z.array(pushTicketSchema).optional(),
  errors: z
    .array(z.object({ code: z.string().optional(), message: z.string().optional() }))
    .optional(),
});

/**
 * Entrega por notificación push usando el servicio de Expo.
 *
 * Expo es el intermediario: recibe el token que la app registró y lo traduce a
 * FCM (Android) o APNs (iOS) con las credenciales que viven en el proyecto de
 * EAS. Por eso aquí no hay ninguna clave de Google ni de Apple.
 *
 * Un mensaje del dominio va a *todos* los dispositivos activos de la persona,
 * que es lo que espera cualquiera con el teléfono y la tablet abiertos. Si no
 * hay ninguno, el envío se da por terminado en vez de fallar: reintentarlo no
 * va a hacer aparecer un dispositivo, y dejar el mensaje reintentando hasta la
 * cola de muertos sólo llenaría la bandeja de salida de ruido.
 */
@Injectable()
export class ExpoPushNotificationAdapter implements NotificationDeliveryAdapter {
  private readonly logger = new Logger(ExpoPushNotificationAdapter.name);

  constructor(private readonly deviceTokens: DeviceTokenRepository) {}

  async deliver(
    request: NotificationDeliveryRequest,
  ): Promise<NotificationDeliveryResult> {
    if (!env.PUSH_NOTIFICATIONS_ENABLED) {
      throw new ServiceUnavailableException('Push delivery is disabled.');
    }

    const tokens = await this.deviceTokens.listActiveForUser(
      request.recipientUserId,
    );
    if (tokens.length === 0) {
      return {
        provider: 'EXPO_PUSH',
        providerMessageId: null,
        responseCode: 'NO_ACTIVE_DEVICE',
      };
    }

    const expired: string[] = [];
    const ticketIds: string[] = [];
    // Razones de fallo que pueden dejar de darse —Expo caído, límite de
    // frecuencia—, a diferencia de un dispositivo que ya no existe.
    const retryableFailures: string[] = [];

    for (let index = 0; index < tokens.length; index += MAX_MESSAGES_PER_REQUEST) {
      const batch = tokens.slice(index, index + MAX_MESSAGES_PER_REQUEST);
      const tickets = await this.send(
        batch.map((token) => ({
          to: token.expoPushToken,
          title: request.subject ?? 'GymSheet',
          body: request.body,
          // El identificador viaja con el aviso para que al tocarlo la app
          // pueda abrir esa notificación concreta y marcarla leída.
          data: { notificationId: request.notificationId },
        })),
        request.idempotencyKey,
      );

      // Expo devuelve un ticket por mensaje, en el mismo orden que se enviaron:
      // es la única forma de saber a qué token corresponde cada error.
      tickets.forEach((ticket, position) => {
        const token = batch[position];
        if (ticket.status === 'ok') {
          ticketIds.push(ticket.id ?? '');
          return;
        }
        const reason = ticket.details?.error ?? 'UnknownTicketError';
        if (reason === 'DeviceNotRegistered') {
          if (token) expired.push(token.expoPushToken);
          return;
        }
        retryableFailures.push(reason);
      });
    }

    if (expired.length > 0) {
      const revoked = await this.deviceTokens.revokeTokens(expired);
      this.logger.log({
        event: 'push.tokens_revoked',
        recipientUserId: request.recipientUserId,
        revoked,
      });
    }

    if (ticketIds.length === 0) {
      // Todos los destinos fallaron. Si alguno lo hizo por una razón que puede
      // cambiar vale la pena reintentar; si el único motivo fue que los
      // dispositivos ya no existen, no.
      const [reason] = retryableFailures;
      if (reason) {
        throw new ServiceUnavailableException(
          `Expo push rejected every device (${reason}).`,
        );
      }
      return {
        provider: 'EXPO_PUSH',
        providerMessageId: null,
        responseCode: 'NO_ACTIVE_DEVICE',
      };
    }

    return {
      provider: 'EXPO_PUSH',
      providerMessageId: ticketIds.find((id) => id.length > 0) ?? null,
      responseCode: `ACCEPTED_${ticketIds.length}`,
    };
  }

  private async send(
    messages: ReadonlyArray<Record<string, unknown>>,
    idempotencyKey: string,
  ): Promise<z.infer<typeof pushTicketSchema>[]> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), env.EXPO_PUSH_TIMEOUT_MS);
    try {
      const response = await fetch(env.EXPO_PUSH_API_URL, {
        method: 'POST',
        redirect: 'error',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'X-Idempotency-Key': idempotencyKey,
          ...(env.EXPO_PUSH_ACCESS_TOKEN
            ? { Authorization: `Bearer ${env.EXPO_PUSH_ACCESS_TOKEN}` }
            : {}),
        },
        body: JSON.stringify(messages),
      });
      if (!response.ok) {
        throw new ServiceUnavailableException(
          `Expo push service returned HTTP ${response.status}.`,
        );
      }
      const parsed = pushResponseSchema.safeParse(await response.json());
      if (!parsed.success) {
        throw new ServiceUnavailableException(
          'Expo push service returned an unreadable response.',
        );
      }
      // `errors` a nivel de petición significa que no se envió nada: ningún
      // ticket es de fiar y el trabajo tiene que volver a intentarse entero.
      if (parsed.data.errors?.length) {
        throw new ServiceUnavailableException(
          `Expo push service rejected the request (${
            parsed.data.errors[0]?.code ?? 'unknown'
          }).`,
        );
      }
      return parsed.data.data ?? [];
    } catch (error: unknown) {
      if (error instanceof ServiceUnavailableException) throw error;
      throw new ServiceUnavailableException('Expo push request failed.');
    } finally {
      clearTimeout(timeout);
    }
  }
}
