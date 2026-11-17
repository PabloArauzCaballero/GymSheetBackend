import { UniqueConstraintError } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import { BrandNameService } from '../../common/branding/brand-name.service';
import { NotificationChannel } from '../../common/enums/domain.enums';
import { OutboxJobModel } from '../integration/outbox-job.model';
import { OutboxService } from '../integration/outbox.service';
import { NotificationAdapterFactory } from './delivery/notification-adapter.factory';
import { NoticeEmailService, NOTICE_EMAIL_QUEUE } from './notice-email.service';
import { NotificationDeliveryService } from './notification-delivery.service';
import { NotificationRepository } from './notification.repository';

const userId = '00000000-0000-4000-8000-000000000001';
const caller = { id: 'caller-tx' };
const savepoint = { id: 'savepoint' };

function build(email: string | null, enqueue = jest.fn().mockResolvedValue(undefined)) {
  const repository = { openAccountEmail: jest.fn().mockResolvedValue(email) };
  const brands = { forUser: jest.fn().mockResolvedValue('Top Fitness') };
  const sequelize = {
    transaction: jest.fn((...args: unknown[]) => (args[args.length - 1] as (t: unknown) => unknown)(savepoint)),
  };
  const service = new NoticeEmailService(
    repository as unknown as NotificationRepository,
    { enqueue } as unknown as OutboxService,
    brands as unknown as BrandNameService,
    sequelize as unknown as Sequelize,
  );
  return { service, repository, enqueue, sequelize };
}

describe('NoticeEmailService', () => {
  it('writes a self-contained email job to the address on file, inside a savepoint of the caller transaction', async () => {
    const { service, enqueue, repository, sequelize } = build('ana@example.test');
    await expect(
      service.enqueue({ recipientUserId: userId, subject: 'Tu cuenta ha sido suspendida', body: 'Motivo: Spam.', deduplicationKey: 'k1' }, caller as never),
    ).resolves.toBe(true);
    expect(sequelize.transaction).toHaveBeenCalledWith({ transaction: caller }, expect.any(Function));
    expect(repository.openAccountEmail).toHaveBeenCalledWith(userId, savepoint);
    expect(enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        queueName: NOTICE_EMAIL_QUEUE,
        deduplicationKey: 'notice-email:k1',
        payload: {
          schemaVersion: 1,
          kind: 'NOTICE_EMAIL',
          recipientUserId: userId,
          to: 'ana@example.test',
          subject: 'Top Fitness: Tu cuenta ha sido suspendida',
          body: 'Motivo: Spam.\n\nTop Fitness',
          survivesClosure: false,
        },
      }),
      savepoint,
    );
  });

  it('marks the closure notice as surviving the closure', async () => {
    const { service, enqueue } = build('ana@example.test');
    await service.enqueue({ recipientUserId: userId, subject: 's', body: 'b', deduplicationKey: 'k', survivesClosure: true });
    expect((enqueue.mock.calls[0] as [{ payload: { survivesClosure: boolean } }])[0].payload.survivesClosure).toBe(true);
  });

  it('writes nothing for an account without an address, and absorbs a repeated key', async () => {
    const closed = build(null);
    await expect(closed.service.enqueue({ recipientUserId: userId, subject: 's', body: 'b', deduplicationKey: 'k' })).resolves.toBe(false);
    expect(closed.enqueue).not.toHaveBeenCalled();
    const repeated = build('ana@example.test', jest.fn().mockRejectedValue(new UniqueConstraintError({})));
    await expect(repeated.service.enqueue({ recipientUserId: userId, subject: 's', body: 'b', deduplicationKey: 'k' })).resolves.toBe(false);
  });
});

describe('NotificationDeliveryService with a notice email job', () => {
  it('mails the address the job carries, with no message row involved', async () => {
    const adapter = { deliver: jest.fn().mockResolvedValue({ provider: 'EMAIL_LOG', providerMessageId: null, responseCode: 'SENT' }) };
    const forChannel = jest.fn().mockReturnValue(adapter);
    const repository = { findMessage: jest.fn() };
    const service = new NotificationDeliveryService(
      repository as unknown as NotificationRepository,
      { forChannel } as unknown as NotificationAdapterFactory,
      {} as Sequelize,
    );
    const job = {
      id: '00000000-0000-4000-8000-0000000000j1',
      deduplicationKey: 'notice-email:k1',
      attemptCount: 1,
      payload: {
        schemaVersion: 1, kind: 'NOTICE_EMAIL', recipientUserId: userId, to: 'old@example.test',
        subject: 'REPP: Tu cuenta ha sido cerrada', body: 'Motivo: Menor de edad.', survivesClosure: true,
      },
    } as unknown as OutboxJobModel;

    await service.deliver(job);

    expect(forChannel).toHaveBeenCalledWith(NotificationChannel.EMAIL);
    expect(adapter.deliver).toHaveBeenCalledWith(expect.objectContaining({
      recipientUserId: userId,
      recipientEmail: 'old@example.test',
      subject: 'REPP: Tu cuenta ha sido cerrada',
      idempotencyKey: 'notice-email:k1',
    }));
    expect(repository.findMessage).not.toHaveBeenCalled();
  });
});
