import { Injectable, Logger } from "@nestjs/common";
import { Transaction, UniqueConstraintError } from "sequelize";
import { Sequelize } from "sequelize-typescript";
import { z } from "zod";
import { BrandNameService } from "../../common/branding/brand-name.service";
import { OutboxService } from "../integration/outbox.service";
import { NotificationRepository } from "./notification.repository";

/** Same queue and worker as every other delivery; the payload shape tells them apart. */
export const NOTICE_EMAIL_QUEUE = "notifications.delivery";
const NOTICE_EMAIL_EVENT = "notification.notice-email.v1";
const NOTICE_EMAIL_MAX_ATTEMPTS = 10;

/**
 * A self-contained email job: it carries the address, subject and body it
 * needs and points at no `notifications.messages` row. That is what lets the
 * notice of a closure outlive the closure, which erases the account's
 * messages and anonymizes its address. `survivesClosure` exempts the job from
 * the closure's purge of pending deliveries; every other one is dropped with
 * the account.
 */
export const noticeEmailPayloadSchema = z
  .object({
    schemaVersion: z.literal(1),
    kind: z.literal("NOTICE_EMAIL"),
    recipientUserId: z.string().uuid(),
    to: z.string().email(),
    subject: z.string().min(1).max(250),
    body: z.string().min(1).max(5000),
    survivesClosure: z.boolean(),
  })
  .strict();
export type NoticeEmailPayload = z.infer<typeof noticeEmailPayloadSchema>;

export type NoticeEmailInput = {
  recipientUserId: string;
  subject: string;
  body: string;
  deduplicationKey: string;
  /** Only for the notice of a closure decided by moderation. */
  survivesClosure?: boolean;
};

/**
 * Emails a notice that must reach the person even when the app cannot: a
 * suspended or banned account cannot open its inbox, and a closed one has
 * none. The address is the one on file when the notice is decided, read in
 * the caller's transaction; the email signs with the person's gym (or the
 * product). The job is written in that same transaction (outbox), so the
 * email exists only if the decision commits.
 */
@Injectable()
export class NoticeEmailService {
  private readonly logger = new Logger(NoticeEmailService.name);

  constructor(
    private readonly repository: NotificationRepository,
    private readonly outbox: OutboxService,
    private readonly brands: BrandNameService,
    private readonly sequelize: Sequelize,
  ) {}

  /** Returns false when the account has no address (closed) or the key was already used. */
  async enqueue(input: NoticeEmailInput, transaction?: Transaction): Promise<boolean> {
    const work = async (current: Transaction): Promise<boolean> => {
      const to = await this.repository.openAccountEmail(input.recipientUserId, current);
      if (!to) {
        this.logger.warn({ event: "notice_email.no_address", recipientUserId: input.recipientUserId });
        return false;
      }
      const brand = await this.brands.forUser(input.recipientUserId, current);
      const payload: NoticeEmailPayload = {
        schemaVersion: 1,
        kind: "NOTICE_EMAIL",
        recipientUserId: input.recipientUserId,
        to,
        subject: `${brand}: ${input.subject}`,
        body: `${input.body}\n\n${brand}`,
        survivesClosure: input.survivesClosure ?? false,
      };
      await this.outbox.enqueue(
        {
          queueName: NOTICE_EMAIL_QUEUE,
          eventType: NOTICE_EMAIL_EVENT,
          aggregateType: "account",
          aggregateId: input.recipientUserId,
          deduplicationKey: `notice-email:${input.deduplicationKey}`,
          payload,
          maxAttempts: NOTICE_EMAIL_MAX_ATTEMPTS,
        },
        current,
      );
      return true;
    };
    try {
      // A savepoint: a repeated key must not abort the caller's transaction.
      return transaction
        ? await this.sequelize.transaction({ transaction }, work)
        : await this.sequelize.transaction(work);
    } catch (error: unknown) {
      if (error instanceof UniqueConstraintError) return false;
      throw error;
    }
  }
}
