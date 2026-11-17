import { Sequelize } from 'sequelize-typescript';
import { NotificationChannel, NotificationStatus } from '../../common/enums/domain.enums';
import { OutboxJobModel } from '../integration/outbox-job.model';
import { NotificationAdapterFactory } from './delivery/notification-adapter.factory';
import { NotificationDeliveryService, SECRET_BODY_REDACTED } from './notification-delivery.service';
import { NotificationRepository } from './notification.repository';

const notificationId = '00000000-0000-4000-8000-0000000000aa';

function build(secret: boolean) {
  const message = {
    id: notificationId,
    recipientUserId: 'user-1',
    channel: NotificationChannel.EMAIL,
    subject: 'Confirma tu correo en GymSheet',
    body: 'Tu código para confirmar el correo es 123456',
    daysRemaining: null,
    status: NotificationStatus.PENDING,
    metadata: {},
    secret,
  };
  const repository = {
    findMessage: jest.fn().mockResolvedValue(message),
    createDeliveryAttempt: jest.fn().mockResolvedValue(undefined),
    updateDeliveryState: jest.fn().mockResolvedValue(undefined),
  };
  const adapter = { deliver: jest.fn().mockResolvedValue({ provider: 'LOG', providerMessageId: 'm-1', responseCode: '200' }) };
  const service = new NotificationDeliveryService(
    repository as unknown as NotificationRepository,
    { forChannel: () => adapter } as unknown as NotificationAdapterFactory,
    { transaction: jest.fn((work: (t: unknown) => unknown) => work({})) } as unknown as Sequelize,
  );
  const job = { payload: { notificationId }, deduplicationKey: 'k', attemptCount: 1 } as unknown as OutboxJobModel;
  return { service, repository, adapter, job, message };
}

describe('NotificationDeliveryService secret messages', () => {
  it('delivers the PIN by email and then redacts the stored body', async () => {
    const { service, repository, adapter, job } = build(true);
    await service.deliver(job);

    expect(adapter.deliver).toHaveBeenCalledWith(expect.objectContaining({ body: expect.stringContaining('123456') }));
    expect(repository.updateDeliveryState).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ status: NotificationStatus.SENT, body: SECRET_BODY_REDACTED }),
      expect.anything(),
    );
  });

  it('keeps the body of an ordinary message', async () => {
    const { service, repository, job } = build(false);
    await service.deliver(job);

    const [, changes] = repository.updateDeliveryState.mock.calls[0] as [unknown, Record<string, unknown>];
    expect(changes).not.toHaveProperty('body');
  });
});
