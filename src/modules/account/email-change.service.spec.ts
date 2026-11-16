import { ConflictException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { Sequelize } from 'sequelize-typescript';
import { EmailVerificationService } from '../auth/email-verification.service';
import { ClosedAccountSanctionsService } from '../closed-account-sanctions/closed-account-sanctions.service';
import { NotificationService } from '../notifications/notification.service';
import { UsersRepository } from '../users/users.repository';
import { EmailChangeService } from './email-change.service';

const userId = '00000000-0000-4000-8000-000000000001';
const transaction = { id: 'tx' };

async function build(options: { pin?: object; holderId?: string; sanctioned?: boolean } = {}) {
  const user = { id: userId, email: 'old@example.test', passwordHash: await bcrypt.hash('secret-pass', 4) };
  const users = {
    findActiveById: jest.fn().mockResolvedValue(user),
    lockUserForUpdate: jest.fn().mockResolvedValue(undefined),
    findByEmail: jest.fn().mockResolvedValue(options.holderId ? { id: options.holderId } : null),
    changeEmail: jest.fn().mockResolvedValue(undefined),
  };
  const pins = {
    issuePurposePin: jest.fn().mockResolvedValue(undefined),
    verifyPurposePin: jest.fn().mockResolvedValue(options.pin ?? { kind: 'VERIFIED', targetEmail: 'new@example.test' }),
  };
  const notifications = { enqueueDirectMessage: jest.fn().mockResolvedValue(true) };
  const sequelize = { transaction: jest.fn((work: (t: unknown) => unknown) => work(transaction)) };
  const sanctions = { hasActiveSanction: jest.fn().mockResolvedValue(options.sanctioned ?? false) };
  const service = new EmailChangeService(
    users as unknown as UsersRepository,
    pins as unknown as EmailVerificationService,
    notifications as unknown as NotificationService,
    sequelize as unknown as Sequelize,
    sanctions as unknown as ClosedAccountSanctionsService,
  );
  return { service, users, pins, notifications, sanctions };
}

describe('EmailChangeService.request', () => {
  it('needs the current password and a different address', async () => {
    const { service, pins } = await build();
    await expect(service.request(userId, { newEmail: 'new@example.test', password: 'nope' })).rejects.toMatchObject({ code: 'CURRENT_PASSWORD_INVALID' });
    await expect(service.request(userId, { newEmail: 'old@example.test', password: 'secret-pass' })).rejects.toMatchObject({ code: 'EMAIL_UNCHANGED' });
    expect(pins.issuePurposePin).not.toHaveBeenCalled();
  });

  it('mails a CHANGE_EMAIL PIN to the new address', async () => {
    const { service, pins } = await build();
    await service.request(userId, { newEmail: 'new@example.test', password: 'secret-pass' });
    const [, purpose, message] = pins.issuePurposePin.mock.calls[0] as [string, string, { recipientEmail: string; targetEmail: string }];
    expect(purpose).toBe('CHANGE_EMAIL');
    expect(message).toMatchObject({ recipientEmail: 'new@example.test', targetEmail: 'new@example.test' });
  });
});

describe('EmailChangeService while sanctioned', () => {
  it('refuses the request and the confirmation with a stable 409 code (no ban evasion by alias + closure)', async () => {
    const { service, pins, users, sanctions } = await build({ sanctioned: true });
    await expect(service.request(userId, { newEmail: 'new@example.test', password: 'secret-pass' }))
      .rejects.toMatchObject({ status: 409, code: 'EMAIL_CHANGE_BLOCKED_BY_SANCTION' });
    expect(pins.issuePurposePin).not.toHaveBeenCalled();
    await expect(service.confirm(userId, '123456')).rejects.toMatchObject({ code: 'EMAIL_CHANGE_BLOCKED_BY_SANCTION' });
    expect(sanctions.hasActiveSanction).toHaveBeenLastCalledWith(userId, transaction);
    expect(pins.verifyPurposePin).not.toHaveBeenCalled();
    expect(users.changeEmail).not.toHaveBeenCalled();
  });
});

describe('EmailChangeService.confirm', () => {
  it('swaps the address and tells the old mailbox in the same transaction', async () => {
    const { service, users, notifications } = await build();
    await expect(service.confirm(userId, '123456')).resolves.toEqual({ email: 'new@example.test', emailVerified: true });
    expect(users.changeEmail).toHaveBeenCalledWith(userId, 'new@example.test', transaction);
    const [notice, tx] = notifications.enqueueDirectMessage.mock.calls[0] as [{ metadata: unknown; body: string }, unknown];
    expect(notice.metadata).toEqual({ kind: 'EMAIL_CHANGED', recipientEmail: 'old@example.test' });
    expect(notice.body).not.toContain('new@example.test');
    expect(tx).toBe(transaction);
  });

  it('answers 409 when another account holds the address', async () => {
    const { service, users } = await build({ holderId: '00000000-0000-4000-8000-000000000002' });
    await expect(service.confirm(userId, '123456')).rejects.toBeInstanceOf(ConflictException);
    expect(users.changeEmail).not.toHaveBeenCalled();
  });

  it('throws the PIN error after committing the failed attempt', async () => {
    const { service, users } = await build({ pin: { kind: 'EXPIRED' } });
    await expect(service.confirm(userId, '123456')).rejects.toMatchObject({ code: 'EMAIL_PIN_EXPIRED' });
    expect(users.changeEmail).not.toHaveBeenCalled();
  });
});
