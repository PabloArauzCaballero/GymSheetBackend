import { randomUUID } from 'node:crypto';
import { QueryTypes } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import request from 'supertest';
import { bootE2eApp, E2E_SIGNUP_FIELDS, E2eApp } from './support/e2e-app';

/**
 * Device registry: every sign-in records its installation, refresh tokens are
 * bound to it, a new installation triggers an email, and revoking a device
 * ends its sessions. UI → request → response → persistence → reload.
 */
describe('device registry (e2e)', () => {
  let e2e: E2eApp;
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const password = 'devices-e2e-password';
  const phone = randomUUID();
  const laptop = randomUUID();

  beforeAll(async () => {
    e2e = await bootE2eApp();
  }, 60_000);
  afterAll(async () => {
    await e2e?.app.close();
  });

  const withDevice = (test: request.Test, installationId: string, platform: string) =>
    test
      .set('X-Installation-Id', installationId)
      .set('X-Client-Platform', platform)
      .set('X-App-Version', '2.4.0')
      .set('X-OS-Version', '15')
      .set('X-Device-Model', 'Pixel 8');

  const alerts = async (userId: string) =>
    e2e.app.get(Sequelize).query<{ subject: string; body: string }>(
      `SELECT subject, body FROM notifications.messages
        WHERE recipient_user_id = :userId AND deduplication_key LIKE 'new-device-%'`,
      { type: QueryTypes.SELECT, replacements: { userId } },
    );

  it('records devices, alerts on a new one, and ends the sessions of a revoked one', async () => {
    const email = `devices-owner-${suffix}@example.test`;
    const signup = await withDevice(request(e2e.http).post(e2e.url('/auth/register')), phone, 'android')
      .send({ email, password, nombreCompleto: 'Devices Owner', ...E2E_SIGNUP_FIELDS })
      .expect(201);
    const userId = signup.body.data.user.id as string;
    const phoneRefresh = signup.body.data.refreshToken as string;

    // First device: recorded, no alert.
    const listed = await withDevice(e2e.as(signup.body.data.accessToken as string).get('/me/devices'), phone, 'android')
      .expect(200);
    expect(listed.body.data).toEqual([
      expect.objectContaining({ platform: 'ANDROID', deviceModel: 'Pixel 8', osVersion: '15', appVersion: '2.4.0', current: true }),
    ]);
    expect(JSON.stringify(listed.body.data)).not.toContain(phone);
    expect(await alerts(userId)).toHaveLength(0);

    // Login from a second installation: new device, one alert without the IP.
    const login = await withDevice(request(e2e.http).post(e2e.url('/auth/login')), laptop, 'web')
      .send({ email, password })
      .expect(201);
    const laptopRefresh = login.body.data.refreshToken as string;
    const sent = await alerts(userId);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.subject).toBe('Nuevo inicio de sesión');
    // Same installation again: no second alert.
    await withDevice(request(e2e.http).post(e2e.url('/auth/login')), laptop, 'web').send({ email, password }).expect(201);
    expect(await alerts(userId)).toHaveLength(1);

    const api = e2e.as(login.body.data.accessToken as string);
    const both = (await withDevice(api.get('/me/devices'), laptop, 'web').expect(200)).body.data as Array<{
      id: string;
      platform: string;
      current: boolean;
    }>;
    expect(both).toHaveLength(2);
    const laptopDevice = both.find((device) => device.current);
    const phoneDevice = both.find((device) => !device.current);
    expect(laptopDevice?.platform).toBe('WEB');

    // Another account cannot see or revoke it: 404, not 403.
    const stranger = await e2e.register('devices-stranger');
    await e2e.as(stranger.token).del(`/me/devices/${phoneDevice?.id}`).expect(404);
    await e2e.as(stranger.token).del('/me/devices/not-a-uuid').expect(400);
    // The stranger signed up without device headers: it sees only its own
    // server-assigned device, never this account's.
    const strangerDevices = (await e2e.as(stranger.token).get('/me/devices').expect(200)).body.data as Array<{ id: string }>;
    expect(strangerDevices).toHaveLength(1);
    expect(strangerDevices.map((device) => device.id)).not.toContain(phoneDevice?.id);

    // Revoke the phone: its refresh token stops working, the laptop's keeps rotating.
    await api.del(`/me/devices/${phoneDevice?.id}`).expect(204);
    await request(e2e.http).post(e2e.url('/auth/refresh')).send({ refreshToken: phoneRefresh }).expect(401);
    const rotated = await withDevice(request(e2e.http).post(e2e.url('/auth/refresh')), laptop, 'web')
      .send({ refreshToken: laptopRefresh })
      .expect(201);
    expect(rotated.body.data.refreshToken).not.toBe(laptopRefresh);
    const rows = await e2e.app.get(Sequelize).query<{ revoked_reason: string | null; device_id: string | null }>(
      `SELECT revoked_reason, device_id FROM auth.refresh_tokens WHERE user_id = :userId ORDER BY created_at`,
      { type: QueryTypes.SELECT, replacements: { userId } },
    );
    expect(rows.every((row) => row.device_id !== null)).toBe(true);
    expect(rows.some((row) => row.revoked_reason === 'DEVICE_REVOKED')).toBe(true);
    const remaining = await api.get('/me/devices').expect(200);
    expect(remaining.body.data.map((device: { id: string }) => device.id)).toEqual([laptopDevice?.id]);

    // Signing in again with the password re-authorizes the revoked installation.
    await withDevice(request(e2e.http).post(e2e.url('/auth/login')), phone, 'android').send({ email, password }).expect(201);
    expect((await api.get('/me/devices').expect(200)).body.data).toHaveLength(2);
  });

  it('gives clients without device headers a revocable server-assigned device', async () => {
    const email = `devices-headerless-${Date.now()}@example.test`;
    const password = 'headerless-e2e-password';
    const signup = await request(e2e.http)
      .post(e2e.url('/auth/register'))
      .send({ email, password, nombreCompleto: 'Headerless Person', ...E2E_SIGNUP_FIELDS })
      .expect(201);
    const api = e2e.as(signup.body.data.accessToken as string);
    const listed = (await api.get('/me/devices').expect(200)).body.data as Array<{ id: string; platform: string }>;
    expect(listed).toEqual([expect.objectContaining({ platform: 'UNKNOWN' })]);

    // A second headerless sign-in is a second device; "sign out everywhere
    // else" from it ends the first one and keeps itself (its token names its device).
    const second = await request(e2e.http).post(e2e.url('/auth/login')).send({ email, password }).expect(201);
    expect((await api.get('/me/devices').expect(200)).body.data).toHaveLength(2);
    await e2e.as(second.body.data.accessToken as string).post('/me/devices/revoke-others').expect(204);
    await request(e2e.http).post(e2e.url('/auth/refresh')).send({ refreshToken: signup.body.data.refreshToken }).expect(401);
    await request(e2e.http).post(e2e.url('/auth/refresh')).send({ refreshToken: second.body.data.refreshToken }).expect(201);
  });

  it('requires a session for the device endpoints', async () => {
    await request(e2e.http).get(e2e.url('/me/devices')).expect(401);
    await request(e2e.http).delete(e2e.url(`/me/devices/${randomUUID()}`)).expect(401);
  });
});
