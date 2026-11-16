export type NotificationDeliveryRequest = {
  notificationId: string;
  recipientUserId: string;
  /** Mailbox that overrides the account's own address (email change notices). */
  recipientEmail?: string;
  subject: string | null;
  body: string;
  daysRemaining: number | null;
  idempotencyKey: string;
};

export type NotificationDeliveryResult = {
  provider: string;
  providerMessageId: string | null;
  responseCode: string;
};

export interface NotificationDeliveryAdapter {
  deliver(request: NotificationDeliveryRequest): Promise<NotificationDeliveryResult>;
}
