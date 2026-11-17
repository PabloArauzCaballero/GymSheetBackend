import { randomBytes } from 'node:crypto';
import request from 'supertest';
import { env } from '../src/config/env';
import { E2eApp } from './support/e2e-app';
import { KycHarness, bootKycHarness } from './support/kyc-e2e';

type Page = { items: Record<string, unknown>[]; page: number; pageSize: number; total: number; totalPages: number };

/**
 * REPP's account search (ADR-0026, replaces `admin/membership/users`): the
 * account console, the permissions panel and the moderator picker read it.
 */
describe('REPP account search GET /admin/users (e2e, franja 8e)', () => {
  let h: KycHarness;
  let e2e: E2eApp;
  let platform: { token: string; id: string };
  const tag = `adm${randomBytes(3).toString('hex')}`;
  let persons: { token: string; id: string }[];
  let business: { token: string; id: string };
  let moderator: { token: string; id: string };
  const tenantId = `${tag}-tenant`;

  beforeAll(async () => {
    h = await bootKycHarness();
    e2e = h.e2e;
    platform = await e2e.platformAdmin(`${tag}-platform`);
    persons = [await e2e.register(`${tag}-ana`), await e2e.register(`${tag}-bea`), await e2e.register(`${tag}-cris`)];
    business = await h.business(`${tag}-shop`, { email: `${tag}-shop@example.test` });
    moderator = await e2e.register(`${tag}-mod`);
    await e2e.promote(moderator.id, 'MODERATOR');
    await e2e.sql(`INSERT INTO public.tenants (id, nombre, estado) VALUES (:tenantId, 'Admin users e2e', 'ACTIVO')`, { tenantId });
  }, 60000);

  afterAll(async () => {
    await e2e.sql('UPDATE public.usuarios SET tenant_id = :defaultTenant WHERE tenant_id = :tenantId', { defaultTenant: env.DEFAULT_TENANT_ID, tenantId });
    await e2e.sql('DELETE FROM public.tenants WHERE id = :tenantId', { tenantId });
    await h.close();
  });

  const search = async (query: string, token = platform.token): Promise<Page> =>
    (await e2e.as(token).get(`/admin/users?${query}`).expect(200)).body.data as Page;
  const ids = (page: Page) => page.items.map((item) => item.id);

  it('finds accounts by a name or an email fragment, with the shape of the retired route', async () => {
    const byName = await search(`q=${encodeURIComponent(`E2E ${tag}-bea`)}`);
    expect(ids(byName)).toEqual([persons[1].id]);
    const [row] = byName.items;
    expect(Object.keys(row).sort()).toEqual(['email', 'estado', 'id', 'nombreCompleto', 'plan', 'rol', 'telefono', 'tenantId', 'ultimaSesion', 'venceEl', 'vigente']);
    // The gym front desk's fields are kept, neutral and deprecated (ADR-0026).
    expect(row).toMatchObject({ rol: 'CLIENTE', estado: 'ACTIVO', telefono: null, plan: null, venceEl: null, vigente: false });
    expect(ids(await search(`q=${tag}-cris-`))).toEqual([persons[2].id]);
    // A typed % or _ is a character, not a wildcard.
    expect((await search(`q=${encodeURIComponent(`${tag}%cris`)}`)).total).toBe(0);
  });

  it('paginates by name with a stable order and the total of the same read', async () => {
    const first = await search(`q=${tag}&roles=CLIENTE&pageSize=2&page=1`);
    const second = await search(`q=${tag}&roles=CLIENTE&pageSize=2&page=2`);
    expect([first.total, first.totalPages, first.items.length, second.items.length]).toEqual([3, 2, 2, 1]);
    expect([...ids(first), ...ids(second)]).toEqual(persons.map((person) => person.id));
    await e2e.as(platform.token).get('/admin/users?pageSize=101').expect(400);
    await e2e.as(platform.token).get('/admin/users?limit=5').expect(400);
  });

  it('filters by roles (the moderator picker asks only persons) and by status', async () => {
    const people = await search(`q=${tag}&roles=CLIENTE`);
    expect(ids(people)).not.toContain(business.id);
    expect(ids(people)).not.toContain(moderator.id);
    expect(ids(await search(`q=${tag}&roles=NEGOCIO`))).toEqual([business.id]);
    expect(ids(await search(`q=${tag}&roles=MODERATOR,NEGOCIO`)).sort()).toEqual([business.id, moderator.id].sort());
    // Business accounts are accounts REPP operates: listed when no role filter leaves them out.
    expect(ids(await search(`q=${tag}`))).toContain(business.id);
    await e2e.as(platform.token).get('/admin/users?roles=NOPE').expect(400);
    await e2e.sql(`UPDATE public.usuarios SET estado = 'INACTIVO' WHERE id = :id`, { id: persons[0].id });
    expect(ids(await search(`q=${tag}&status=INACTIVO`))).toEqual([persons[0].id]);
    await e2e.sql(`UPDATE public.usuarios SET estado = 'ACTIVO' WHERE id = :id`, { id: persons[0].id });
  });

  it('while impersonating a gym, only that gym’s accounts', async () => {
    await e2e.sql('UPDATE public.usuarios SET tenant_id = :tenantId WHERE id = :id', { tenantId, id: persons[2].id });
    expect(ids(await search(`q=${tag}`))).toContain(persons[2].id);
    const scoped = await e2e.impersonate(platform.token);
    const inGym = await search(`q=${tag}`, scoped);
    expect(ids(inGym)).not.toContain(persons[2].id);
    expect(ids(inGym)).toContain(persons[0].id);
  });

  it('only the platform admin: persons, moderators and businesses get 403; no token 401', async () => {
    for (const token of [persons[0].token, moderator.token, business.token]) {
      expect((await e2e.as(token).get(`/admin/users?q=${tag}`)).status).toBe(403);
    }
    await request(e2e.http).get(e2e.url('/admin/users')).expect(401);
  });
});
