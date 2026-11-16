import { NotFoundException, UnauthorizedException } from '@nestjs/common';
import { Sequelize } from 'sequelize-typescript';
import { NotificationService } from '../notifications/notification.service';
import { ClientDeviceContext } from './client-device-context';
import { UserDeviceRepository } from './user-device.repository';
import { UserDeviceService } from './user-device.service';

const userId = '00000000-0000-4000-8000-000000000001';
const transaction = { id: 'tx' };
const context: ClientDeviceContext = {
  installationId: '3f2b8c1e-5a4d-4e6f-9a1b-2c3d4e5f6a7b',
  platform: 'ANDROID',
  appVersion: '2.4.0',
  osVersion: '15',
  deviceModel: 'Pixel 8',
  userAgent: 'okhttp',
  ipHmac: 'a'.repeat(64),
};

function build(repository: Partial<Record<keyof UserDeviceRepository, jest.Mock>>) {
  const notifications = { enqueueDirectMessage: jest.fn().mockResolvedValue(true) };
  const sequelize = { transaction: jest.fn((work: (t: unknown) => unknown) => work(transaction)) };
  const service = new UserDeviceService(
    repository as unknown as UserDeviceRepository,
    notifications as unknown as NotificationService,
    sequelize as unknown as Sequelize,
  );
  return { service, notifications };
}

describe('UserDeviceService.recordSignIn', () => {
  it('alerts by email when a new installation signs into an account that already has devices', async () => {
    const upsert = jest.fn().mockResolvedValue({ id: 'device-2', revokedAt: null, inserted: true });
    const { service, notifications } = build({ upsert, countOtherDevices: jest.fn().mockResolvedValue(1) });

    await expect(service.recordSignIn(userId, context, transaction as never)).resolves.toBe('device-2');

    expect(upsert).toHaveBeenCalledWith(userId, context.installationId, context, { reactivate: true }, transaction);
    const [message, usedTransaction] = notifications.enqueueDirectMessage.mock.calls[0] as [
      { subject: string; body: string; channel: string },
      unknown,
    ];
    expect(usedTransaction).toBe(transaction);
    expect(message.channel).toBe('EMAIL');
    expect(message.subject).toBe('Nuevo inicio de sesión');
    expect(message.body).toContain('Pixel 8 (Android 15)');
    // The IP is never part of the alert, not even hashed.
    expect(message.body).not.toContain(context.ipHmac);
  });

  it('stays quiet for a known installation and for the first device of the account', async () => {
    const known = build({
      upsert: jest.fn().mockResolvedValue({ id: 'device-1', revokedAt: null, inserted: false }),
      countOtherDevices: jest.fn().mockResolvedValue(3),
    });
    await known.service.recordSignIn(userId, context, transaction as never);
    expect(known.notifications.enqueueDirectMessage).not.toHaveBeenCalled();

    const first = build({
      upsert: jest.fn().mockResolvedValue({ id: 'device-1', revokedAt: null, inserted: true }),
      countOtherDevices: jest.fn().mockResolvedValue(0),
    });
    await first.service.recordSignIn(userId, context, transaction as never);
    expect(first.notifications.enqueueDirectMessage).not.toHaveBeenCalled();
  });

  it('binds a client without an installation id to a server-assigned device, so the session can be revoked', async () => {
    const upsert = jest.fn().mockResolvedValue({ id: 'device-7', revokedAt: null, inserted: true });
    const { service } = build({ upsert, countOtherDevices: jest.fn().mockResolvedValue(0) });
    await expect(
      service.recordSignIn(userId, { ...context, installationId: null }, transaction as never),
    ).resolves.toBe('device-7');
    const [, installationId] = upsert.mock.calls[0] as [string, string];
    expect(installationId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u);
  });
});

describe('UserDeviceService.revokeOthers', () => {
  it('keeps the caller’s device and revokes every other device and session', async () => {
    const findActiveByInstallation = jest.fn().mockResolvedValue({ id: 'device-1' });
    const revokeAllExcept = jest.fn().mockResolvedValue(undefined);
    const { service } = build({ findActiveByInstallation, revokeAllExcept });
    await service.revokeOthers(userId, { deviceId: null, installationId: context.installationId });
    expect(revokeAllExcept).toHaveBeenCalledWith(userId, 'device-1', 'DEVICE_REVOKED', transaction);
  });

  it('keeps the device the session token is bound to, even without device headers', async () => {
    const findActiveByInstallation = jest.fn();
    const revokeAllExcept = jest.fn().mockResolvedValue(undefined);
    const { service } = build({ findActiveByInstallation, revokeAllExcept });
    await service.revokeOthers(userId, { deviceId: 'device-3', installationId: null });
    expect(findActiveByInstallation).not.toHaveBeenCalled();
    expect(revokeAllExcept).toHaveBeenCalledWith(userId, 'device-3', 'DEVICE_REVOKED', transaction);
  });

  it('ends every session when the current device is unknown', async () => {
    const revokeAllExcept = jest.fn().mockResolvedValue(undefined);
    const { service } = build({ findActiveByInstallation: jest.fn(), revokeAllExcept });
    await service.revokeOthers(userId, { deviceId: null, installationId: null });
    expect(revokeAllExcept).toHaveBeenCalledWith(userId, null, 'DEVICE_REVOKED', transaction);
  });
});

describe('UserDeviceService.resolveForRefresh', () => {
  it('ends the session of a revoked device', async () => {
    const { service } = build({
      findById: jest.fn().mockResolvedValue({ id: 'device-1', revokedAt: new Date() }),
      touch: jest.fn(),
    });
    await expect(
      service.resolveForRefresh(userId, 'device-1', context, transaction as never),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('keeps a live device and refreshes its last-seen data', async () => {
    const touch = jest.fn().mockResolvedValue(undefined);
    const { service } = build({ findById: jest.fn().mockResolvedValue({ id: 'device-1', revokedAt: null }), touch });
    await expect(service.resolveForRefresh(userId, 'device-1', context, transaction as never)).resolves.toBe('device-1');
    expect(touch).toHaveBeenCalledWith('device-1', context.ipHmac, transaction);
  });

  it('binds a legacy session without reviving a revoked installation', async () => {
    const upsert = jest.fn().mockResolvedValue({ id: 'device-9', revokedAt: new Date(), inserted: false });
    const { service } = build({ upsert });
    await expect(service.resolveForRefresh(userId, null, context, transaction as never)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(upsert).toHaveBeenCalledWith(userId, context.installationId, context, { reactivate: false }, transaction);
  });
});

describe('UserDeviceService devices of the owner', () => {
  it('flags the current installation and hides identifiers', async () => {
    const row = {
      id: 'device-1',
      installationId: context.installationId,
      platform: 'ANDROID',
      osVersion: '15',
      appVersion: '2.4.0',
      deviceModel: 'Pixel 8',
      firstSeenAt: new Date('2026-11-01T10:00:00Z'),
      lastSeenAt: new Date('2026-11-16T10:00:00Z'),
      revokedAt: null,
    };
    const { service } = build({ listActive: jest.fn().mockResolvedValue([row, { ...row, id: 'device-2', installationId: 'other' }]) });
    const devices = await service.listMine(userId, context.installationId);
    expect(devices.map((device) => device.current)).toEqual([true, false]);
    expect(JSON.stringify(devices)).not.toContain(context.installationId);
  });

  it('revokes an own device and its sessions in one transaction', async () => {
    const revokeOwned = jest.fn().mockResolvedValue(true);
    const revokeDeviceSessions = jest.fn().mockResolvedValue(undefined);
    const { service } = build({ revokeOwned, revokeDeviceSessions });
    await service.revokeMine(userId, 'device-1');
    expect(revokeOwned).toHaveBeenCalledWith(userId, 'device-1', transaction);
    expect(revokeDeviceSessions).toHaveBeenCalledWith('device-1', transaction);
  });

  it('answers 404 for a device that is not the caller’s', async () => {
    const revokeDeviceSessions = jest.fn();
    const { service } = build({ revokeOwned: jest.fn().mockResolvedValue(false), revokeDeviceSessions });
    await expect(service.revokeMine(userId, 'foreign-device')).rejects.toBeInstanceOf(NotFoundException);
    expect(revokeDeviceSessions).not.toHaveBeenCalled();
  });
});
