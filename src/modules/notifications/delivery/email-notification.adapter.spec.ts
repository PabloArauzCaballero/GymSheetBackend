import { UserModel } from '../../users/user.model';
import { EmailNotificationAdapter } from './email-notification.adapter';

describe('EmailNotificationAdapter', () => {
  const transport = { send: jest.fn().mockResolvedValue({ provider: 'LOG', messageId: 'm1' }) };
  const adapter = new EmailNotificationAdapter(transport);
  const request = { notificationId: 'n1', recipientUserId: 'u1', subject: 'S', body: 'B', daysRemaining: null, idempotencyKey: 'k' };

  afterEach(() => jest.restoreAllMocks());

  it('writes to the account address by default', async () => {
    jest.spyOn(UserModel, 'findByPk').mockResolvedValue({ id: 'u1', email: 'account@example.test' } as UserModel);
    await adapter.deliver(request);
    expect(transport.send).toHaveBeenLastCalledWith(expect.objectContaining({ to: 'account@example.test' }));
  });

  it('writes to the explicit mailbox of an email change without reading the account', async () => {
    const lookup = jest.spyOn(UserModel, 'findByPk');
    await adapter.deliver({ ...request, recipientEmail: 'new@example.test' });
    expect(transport.send).toHaveBeenLastCalledWith(expect.objectContaining({ to: 'new@example.test' }));
    expect(lookup).not.toHaveBeenCalled();
  });
});
