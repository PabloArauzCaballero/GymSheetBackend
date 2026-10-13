import { NotificationChannel } from "../../common/enums/domain.enums";
import { UniqueConstraintError } from "sequelize";
import { NotificationService } from "./notification.service";

describe("NotificationService enqueueDirectMessage idempotency (H11.S2.M1)", () => {
  const tx = { id: "transaction-1" };
  const input = {
    recipientUserId: "recipient-1",
    channel: NotificationChannel.IN_APP,
    subject: "Se revisó tu reporte",
    body: "Gracias por avisar.",
    deduplicationKey: "moderation.report-reviewed:report-1",
    metadata: { reportId: "report-1" },
  };

  function createService() {
    const repository = { createMessage: jest.fn() };
    const dates = {};
    const events = { recordAndEnqueue: jest.fn().mockResolvedValue(undefined) };
    const sequelize = {
      transaction: jest.fn(
        (
          optionsOrWork:
            | ((transaction: typeof tx) => unknown)
            | { transaction: typeof tx },
          callback?: (transaction: typeof tx) => unknown,
        ) => {
          const work =
            typeof optionsOrWork === "function" ? optionsOrWork : callback;
          return work?.(tx);
        },
      ),
    };
    const service = new NotificationService(
      repository as never,
      dates as never,
      events as never,
      sequelize as never,
    );
    return { service, repository, events, sequelize };
  }

  it("stores and enqueues one notification with the same idempotency key", async () => {
    const { service, repository, events, sequelize } = createService();
    repository.createMessage.mockResolvedValue({ id: "notification-1" });

    await expect(service.enqueueDirectMessage(input)).resolves.toBe(true);

    expect(sequelize.transaction).toHaveBeenCalledTimes(1);
    expect(repository.createMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        recipientUserId: input.recipientUserId,
        deduplicationKey: input.deduplicationKey,
        status: "PENDING",
      }),
      tx,
    );
    expect(events.recordAndEnqueue).toHaveBeenCalledTimes(1);
    expect(events.recordAndEnqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        aggregateId: "notification-1",
        deduplicationKey: "notification.delivery-requested:notification-1",
      }),
      [
        expect.objectContaining({
          queueName: "notifications.delivery",
          deduplicationKey: `delivery:${input.deduplicationKey}`,
          payload: { notificationId: "notification-1" },
        }),
      ],
      tx,
    );
  });

  it("treats a unique-key retry as already queued and does not enqueue another outbox job", async () => {
    const { service, repository, events } = createService();
    const duplicate = new UniqueConstraintError({ message: "duplicate key" });
    repository.createMessage.mockResolvedValueOnce({ id: "notification-1" });
    repository.createMessage.mockRejectedValueOnce(duplicate);

    await expect(service.enqueueDirectMessage(input)).resolves.toBe(true);
    await expect(service.enqueueDirectMessage(input)).resolves.toBe(false);

    expect(repository.createMessage).toHaveBeenCalledTimes(2);
    expect(events.recordAndEnqueue).toHaveBeenCalledTimes(1);
  });

  it("uses a nested transaction when a caller provides its business transaction", async () => {
    const { service, sequelize, repository, events } = createService();
    const businessTransaction = { id: "accept-connection-transaction" };
    repository.createMessage.mockResolvedValue({ id: "notification-1" });

    await expect(
      service.enqueueDirectMessage(input, businessTransaction as never),
    ).resolves.toBe(true);

    expect(sequelize.transaction).toHaveBeenCalledWith(
      { transaction: businessTransaction },
      expect.any(Function),
    );
    expect(repository.createMessage).toHaveBeenCalledWith(
      expect.any(Object),
      tx,
    );
    expect(events.recordAndEnqueue).toHaveBeenCalledWith(
      expect.any(Object),
      expect.any(Array),
      tx,
    );
  });
});
