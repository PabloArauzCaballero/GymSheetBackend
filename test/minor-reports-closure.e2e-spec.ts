import { spawn } from 'node:child_process';
import request from 'supertest';
import { hashEmail } from '../src/common/privacy/email-hash';
import { env } from '../src/config/env';
import { AccountClosureService } from '../src/modules/account/account-closure.service';
import { MINOR_ACCOUNT_CLOSURE_QUEUE } from '../src/modules/moderation/moderation-minor.service';
import { bootE2eApp, E2E_SIGNUP_FIELDS, E2eApp } from './support/e2e-app';
import { Member, registerModerator, resolveCase } from './support/moderation-e2e';
import { selectRows } from './support/privacy-e2e';

const PASSWORD = 'e2e-strong-password';

/** A report of a minor needs corroboration to suspend, and a confirmed minor is erased by the worker. */
// Each case spawns the account-data worker and waits for its outbox job (~4.5 s alone): the
// default 5 s left no margin and the suite timed out whenever the machine was busy.
jest.setTimeout(30000);

describe('Minor reports and moderation-decided closure (e2e)', () => {
  let e2e: E2eApp;
  let moderator: Member;
  const secret = 'e2e-privacy-pepper-minor-closure-0123456789';
  const config = env as { IP_HASH_SECRET?: string };
  const original = config.IP_HASH_SECRET;

  beforeAll(async () => {
    config.IP_HASH_SECRET = secret;
    e2e = await bootE2eApp();
    moderator = await registerModerator(e2e, 'minor-closure-mod');
  }, 60000);
  afterAll(async () => {
    await e2e?.app.close();
    if (original === undefined) delete config.IP_HASH_SECRET;
    else config.IP_HASH_SECRET = original;
  });

  const reportMinor = (token: string, userId: string) =>
    e2e.as(token).post('/me/reports').send({ targetKind: 'USER', targetId: userId, reason: 'MENOR_DE_EDAD' });
  const suspendedUntil = async (id: string) =>
    (await selectRows<{ until: Date | null }>(e2e, 'SELECT suspended_until AS until FROM public.usuarios WHERE id = :id', { id }))[0].until;
  /**
   * The real `worker:account-data` process (its own module and bootstrap), run
   * until the job of `userId` completes. A child process, because a second Nest
   * context in this process would rebind the app's static Sequelize models.
   */
  const runWorkerUntilDone = async (userId: string) => {
    const worker = spawn(process.execPath, ['-r', 'ts-node/register', 'src/workers/account-data.worker.ts'], {
      env: { ...process.env, IP_HASH_SECRET: secret, TS_NODE_TRANSPILE_ONLY: 'true', WORKER_POLL_INTERVAL_MS: '200' },
      stdio: 'ignore',
    });
    const exited = new Promise((resolve) => worker.once('exit', resolve));
    try {
      for (let attempt = 0; attempt < 150; attempt += 1) {
        const [job] = await selectRows<{ status: string }>(e2e,
          'SELECT status FROM integration.outbox_jobs WHERE queue_name = :queue AND aggregate_id = :id', { queue: MINOR_ACCOUNT_CLOSURE_QUEUE, id: userId });
        if (job?.status === 'COMPLETED' || job?.status === 'DEAD_LETTER') return job.status;
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
      return 'TIMEOUT';
    } finally {
      worker.kill('SIGTERM');
      await exited;
    }
  };

  describe('the automatic suspension', () => {
    it('one report does not suspend; a second distinct reporter does', async () => {
      const [first, second, reported] = [await e2e.register('mr-first'), await e2e.register('mr-second'), await e2e.register('mr-reported')];
      await reportMinor(first.token, reported.id).expect(201);
      expect(await suspendedUntil(reported.id)).toBeNull();
      await e2e.as(reported.token).get('/users/me').expect(200);

      await reportMinor(second.token, reported.id).expect(201);
      expect((await suspendedUntil(reported.id))?.getUTCFullYear()).toBe(9999);
      const refused = await e2e.as(reported.token).get('/users/me').expect(401);
      expect(JSON.stringify(refused.body)).toContain('Tu cuenta está suspendida mientras revisamos un reporte.');
      expect(JSON.stringify(refused.body)).not.toContain('9999');
    });

    it('the same reporter twice does not suspend (the repeat is a 409)', async () => {
      const [reporter, reported] = [await e2e.register('mr-twice'), await e2e.register('mr-twice-reported')];
      await reportMinor(reporter.token, reported.id).expect(201);
      await reportMinor(reporter.token, reported.id).expect(409);
      expect(await suspendedUntil(reported.id)).toBeNull();
    });

    it('a reporter beyond 3 minor reports in 24 h is heard but does not count toward the threshold', async () => {
      const sprayer = await e2e.register('mr-sprayer');
      for (const label of ['mr-spray-a', 'mr-spray-b', 'mr-spray-c']) {
        await reportMinor(sprayer.token, (await e2e.register(label)).id).expect(201);
      }
      const [target, honest, another] = [await e2e.register('mr-spray-target'), await e2e.register('mr-honest'), await e2e.register('mr-another')];
      await reportMinor(sprayer.token, target.id).expect(201);
      await reportMinor(honest.token, target.id).expect(201);
      expect(await suspendedUntil(target.id)).toBeNull();
      await reportMinor(another.token, target.id).expect(201);
      expect((await suspendedUntil(target.id))?.getUTCFullYear()).toBe(9999);
    });
  });

  it('a confirmed minor is erased by the account-data worker, leaves no carried sanction and the job is idempotent', async () => {
    const [reporter, minor] = [await e2e.register('mr-confirm-reporter'), await e2e.register('mr-confirm-minor')];
    const email = (await selectRows<{ email: string }>(e2e, 'SELECT email FROM public.usuarios WHERE id = :id', { id: minor.id }))[0].email;
    await e2e.sql(`INSERT INTO profile.onboarding (user_id, physical_considerations, consent_health, consent_data)
      VALUES (:id, 'Datos de un menor', true, true)`, { id: minor.id });
    await reportMinor(reporter.token, minor.id).expect(201);

    await resolveCase(e2e, moderator, { kind: 'USER', id: minor.id }, { confirmMinor: true });
    expect((await suspendedUntil(minor.id))?.getUTCFullYear()).toBe(9999);
    await expect(runWorkerUntilDone(minor.id)).resolves.toBe('COMPLETED');

    const [account] = await selectRows<{ email: string; estado: string; closed_at: Date | null; suspended_until: Date | null }>(e2e,
      'SELECT email, estado, closed_at, suspended_until FROM public.usuarios WHERE id = :id', { id: minor.id });
    expect(account).toMatchObject({ email: `cerrada-${minor.id}@cuenta-cerrada.invalid`, estado: 'INACTIVO', suspended_until: null });
    expect(account.closed_at).not.toBeNull();
    expect(await selectRows(e2e, 'SELECT 1 FROM profile.onboarding WHERE user_id = :id', { id: minor.id })).toEqual([]);
    expect(await selectRows(e2e, 'SELECT 1 FROM moderation.closed_account_sanctions WHERE email_hmac = :h',
      { h: hashEmail(email, secret) })).toEqual([]);

    // A retried delivery finds the account closed and changes nothing.
    await expect(e2e.app.get(AccountClosureService).closeByModeration(minor.id)).resolves.toBe('ALREADY_CLOSED');
    // As an adult, the same address signs up again with a clean account.
    const ticket = await request(e2e.http).get(e2e.url('/auth/register/ticket')).expect(200);
    await request(e2e.http).post(e2e.url('/auth/register')).send({
      ticket: ticket.body.data.ticket as string, email, password: PASSWORD, nombreCompleto: 'Ya adulta', ...E2E_SIGNUP_FIELDS,
    }).expect(201);
  });

  it('the suspension and the closure are emailed; the closure email survives the closure that erases the inbox', async () => {
    const [first, second, minor] = [await e2e.register('mr-mail-first'), await e2e.register('mr-mail-second'), await e2e.register('mr-mail-minor')];
    const email = (await selectRows<{ email: string }>(e2e, 'SELECT email FROM public.usuarios WHERE id = :id', { id: minor.id }))[0].email;
    const noticeEmails = () => selectRows<{ status: string; payload: { to: string; subject: string; body: string; survivesClosure: boolean } }>(e2e,
      `SELECT status, payload FROM integration.outbox_jobs
        WHERE queue_name = 'notifications.delivery' AND aggregate_id = :id AND payload->>'kind' = 'NOTICE_EMAIL'
        ORDER BY created_at`, { id: minor.id });
    await reportMinor(first.token, minor.id).expect(201);
    await reportMinor(second.token, minor.id).expect(201);
    const [suspension] = await noticeEmails();
    expect(suspension.payload).toMatchObject({ to: email, survivesClosure: false });
    expect(suspension.payload.body).toContain('Menor de edad');

    await resolveCase(e2e, moderator, { kind: 'USER', id: minor.id }, { confirmMinor: true });
    await expect(runWorkerUntilDone(minor.id)).resolves.toBe('COMPLETED');

    // The in-app notices went with the account; the pending suspension email too.
    expect(await selectRows(e2e, 'SELECT 1 FROM notifications.messages WHERE recipient_user_id = :id', { id: minor.id })).toEqual([]);
    const remaining = await noticeEmails();
    expect(remaining).toHaveLength(1);
    expect(remaining[0]).toMatchObject({ status: 'PENDING', payload: { to: email, survivesClosure: true } });
    expect(remaining[0].payload.subject).toContain('Tu cuenta ha sido cerrada');
    expect(remaining[0].payload.body).toContain('borramos sus datos');
  });
});
