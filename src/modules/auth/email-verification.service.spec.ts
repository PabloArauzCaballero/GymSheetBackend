import * as bcrypt from 'bcryptjs';
import { Sequelize } from 'sequelize-typescript';
import { DomainException } from '../../common/errors/domain.exception';
import { NotificationService } from '../notifications/notification.service';
import { UsersRepository } from '../users/users.repository';
import { EmailPinRow, EmailVerificationPinRepository } from './email-verification-pin.repository';
import { EMAIL_PIN_POLICY, EmailVerificationService } from './email-verification.service';

const userId = '00000000-0000-4000-8000-000000000001';
const transaction = { id: 'tx' };

function build(options: {
  verified?: boolean;
  window?: { sent: number; latest: Date | null; oldest: Date | null };
  latestPin?: EmailPinRow | null;
}) {
  const pins = {
    sendWindow: jest.fn().mockResolvedValue(options.window ?? { sent: 0, latest: null, oldest: null }),
    supersedePending: jest.fn().mockResolvedValue(undefined),
    insert: jest.fn().mockResolvedValue(undefined),
    findLatestForUpdate: jest.fn().mockResolvedValue(options.latestPin ?? null),
    recordFailedAttempt: jest.fn().mockResolvedValue(undefined),
    consume: jest.fn().mockResolvedValue(undefined),
  };
  const users = {
    findActiveById: jest
      .fn()
      .mockResolvedValue({ id: userId, emailVerifiedAt: options.verified ? new Date() : null }),
    lockUserForUpdate: jest.fn().mockResolvedValue(undefined),
    markEmailVerified: jest.fn().mockResolvedValue(undefined),
  };
  const notifications = { enqueueDirectMessage: jest.fn().mockResolvedValue(true) };
  const sequelize = { transaction: jest.fn((work: (t: unknown) => unknown) => work(transaction)) };
  const service = new EmailVerificationService(
    pins as unknown as EmailVerificationPinRepository,
    users as unknown as UsersRepository,
    notifications as unknown as NotificationService,
    sequelize as unknown as Sequelize,
  );
  return { service, pins, users, notifications };
}

async function pinRow(pin: string, overrides: Partial<EmailPinRow> = {}): Promise<EmailPinRow> {
  return {
    id: 'pin-1',
    pinHash: await bcrypt.hash(pin, 4),
    expiresAt: new Date(Date.now() + 60_000),
    consumedAt: null,
    attempts: 0,
    ...overrides,
  };
}

describe('EmailVerificationService.issuePin', () => {
  it('stores only a hash, retires the previous PIN and emails the code through the outbox in the same transaction', async () => {
    const { service, pins, users, notifications } = build({});
    await service.issuePin(userId, transaction as never);

    expect(users.lockUserForUpdate).toHaveBeenCalledWith(userId, transaction);
    expect(pins.supersedePending).toHaveBeenCalledWith(userId, transaction);
    const [, storedHash, expiresAt] = pins.insert.mock.calls[0] as [string, string, Date];
    const message = (notifications.enqueueDirectMessage.mock.calls[0] as [{ body: string; channel: string }, unknown]);
    const pin = /(\d{6})/u.exec(message[0].body)?.[1] ?? '';
    expect(message[0].channel).toBe('EMAIL');
    expect(message[1]).toBe(transaction);
    expect(storedHash).not.toContain(pin);
    await expect(bcrypt.compare(pin, storedHash)).resolves.toBe(true);
    expect(expiresAt.getTime() - Date.now()).toBeGreaterThan((EMAIL_PIN_POLICY.ttlMinutes - 1) * 60_000);
  });

  it('enforces the resend cooldown with retryAfterSeconds', async () => {
    const { service, pins } = build({ window: { sent: 1, latest: new Date(Date.now() - 20_000), oldest: new Date() } });
    const error = await service.issuePin(userId, transaction as never).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(DomainException);
    expect(error).toMatchObject({ code: 'EMAIL_PIN_COOLDOWN', details: { retryAfterSeconds: 40 } });
    expect(pins.insert).not.toHaveBeenCalled();
  });

  it('caps the sends per day and says when the next one is possible', async () => {
    const oldest = new Date(Date.now() - 23 * 60 * 60 * 1000);
    const { service } = build({
      window: { sent: EMAIL_PIN_POLICY.maxSendsPerDay, latest: new Date(Date.now() - 120_000), oldest },
    });
    const error = (await service.issuePin(userId, transaction as never).catch((caught: unknown) => caught)) as DomainException;
    expect(error.code).toBe('EMAIL_PIN_COOLDOWN');
    expect(error.details?.retryAfterSeconds).toBeGreaterThan(3500);
    expect(error.details?.retryAfterSeconds).toBeLessThanOrEqual(3600);
  });

  it('does nothing for an already verified mailbox', async () => {
    const { service, pins, notifications } = build({ verified: true });
    await service.requestPin(userId);
    expect(pins.insert).not.toHaveBeenCalled();
    expect(notifications.enqueueDirectMessage).not.toHaveBeenCalled();
  });
});

describe('EmailVerificationService.confirm', () => {
  it('verifies the account and spends the PIN', async () => {
    const { service, pins, users } = build({ latestPin: await pinRow('123456') });
    await expect(service.confirm(userId, '123456')).resolves.toEqual({ verified: true });
    expect(pins.consume).toHaveBeenCalledWith('pin-1', transaction);
    expect(users.markEmailVerified).toHaveBeenCalledWith(userId, transaction);
  });

  it('counts a wrong PIN and reports the attempts left', async () => {
    const { service, pins, users } = build({ latestPin: await pinRow('123456', { attempts: 1 }) });
    await expect(service.confirm(userId, '000000')).rejects.toMatchObject({
      code: 'EMAIL_PIN_INVALID',
      details: { attemptsRemaining: 3 },
    });
    expect(pins.recordFailedAttempt).toHaveBeenCalledWith('pin-1', false, transaction);
    expect(users.markEmailVerified).not.toHaveBeenCalled();
  });

  it('burns the PIN on the last allowed failure', async () => {
    const { service, pins } = build({
      latestPin: await pinRow('123456', { attempts: EMAIL_PIN_POLICY.maxAttempts - 1 }),
    });
    await expect(service.confirm(userId, '000000')).rejects.toMatchObject({ code: 'EMAIL_PIN_EXHAUSTED' });
    expect(pins.recordFailedAttempt).toHaveBeenCalledWith('pin-1', true, transaction);
  });

  it('keeps refusing an exhausted PIN even with the right digits', async () => {
    const { service, users } = build({
      latestPin: await pinRow('123456', { attempts: EMAIL_PIN_POLICY.maxAttempts, consumedAt: new Date() }),
    });
    await expect(service.confirm(userId, '123456')).rejects.toMatchObject({ code: 'EMAIL_PIN_EXHAUSTED' });
    expect(users.markEmailVerified).not.toHaveBeenCalled();
  });

  it('refuses an expired PIN with its own code', async () => {
    const { service } = build({ latestPin: await pinRow('123456', { expiresAt: new Date(Date.now() - 1) }) });
    await expect(service.confirm(userId, '123456')).rejects.toMatchObject({ code: 'EMAIL_PIN_EXPIRED' });
  });

  it('refuses a superseded PIN and a missing one as invalid', async () => {
    const superseded = build({ latestPin: await pinRow('123456', { consumedAt: new Date() }) });
    await expect(superseded.service.confirm(userId, '123456')).rejects.toMatchObject({ code: 'EMAIL_PIN_INVALID' });
    const none = build({ latestPin: null });
    await expect(none.service.confirm(userId, '123456')).rejects.toMatchObject({ code: 'EMAIL_PIN_INVALID' });
  });

  it('is idempotent once verified', async () => {
    const { service, pins } = build({ verified: true });
    await expect(service.confirm(userId, '000000')).resolves.toEqual({ verified: true });
    expect(pins.findLatestForUpdate).not.toHaveBeenCalled();
  });
});
