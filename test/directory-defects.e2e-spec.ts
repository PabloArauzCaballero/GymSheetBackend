import { randomUUID } from 'node:crypto';
import { QueryTypes } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import { businessNameSkeleton } from '../src/modules/business-accounts/handle-rules';
import { E2eApp, bootE2eApp } from './support/e2e-app';

/**
 * Directory defects closed in franja 8a (ADR-0020). Each test was run first
 * against the code before the fix (061c220), where D1, D3, D4, D5, D7, D8 and
 * D12 fail; D2 was already closed by franja 7a and is pinned here.
 */
describe('directory defects (e2e, franja 8a)', () => {
  let e2e: E2eApp;
  let sequelize: Sequelize;
  let categoryId: string;
  const created: string[] = [];

  async function insertEntity(fields: { tenantId?: string | null; userId?: string | null; status?: string } = {}): Promise<string> {
    const id = randomUUID();
    await e2e.sql(
      `INSERT INTO directory.entities (id, slug, entity_type, name, name_skeleton, description, primary_category_id, tenant_id, user_id, status)
       VALUES (:id, :slug, 'GYM', 'Gimnasio E2E', :skeleton, 'Ficha de prueba', :categoryId, :tenantId, :userId, :status)`,
      { id, slug: `e2e-${id}`, skeleton: businessNameSkeleton('Gimnasio E2E'), categoryId, tenantId: fields.tenantId ?? null, userId: fields.userId ?? null, status: fields.status ?? 'ACTIVE' },
    );
    created.push(id);
    return id;
  }

  async function insertPlan(entityId: string): Promise<string> {
    const id = randomUUID();
    await e2e.sql(
      // A published listing (ADR-0022): LIVE, so the seller's status is what each test exercises.
      `INSERT INTO directory.entity_plans (id, entity_id, type, name, slug, description, current_price, metadata, duration_days, moderation_status, published_at)
       VALUES (:id, :entityId, 'MEMBERSHIP_PLAN', 'Plan E2E', :slug, 'Plan de prueba', 100, '{"internal":"secret"}', 30, 'LIVE', now())`,
      { id, entityId, slug: `plan-${id}` },
    );
    return id;
  }

  const review = { rating: 5, title: 'Muy bueno', body: 'Un lugar excelente para entrenar.' };

  beforeAll(async () => {
    e2e = await bootE2eApp();
    sequelize = e2e.app.get(Sequelize);
    const [category] = await sequelize.query<{ id: string }>(
      `SELECT id FROM directory.categories WHERE entity_scope IN ('GYM', 'ALL') ORDER BY display_order LIMIT 1`,
      { type: QueryTypes.SELECT },
    );
    categoryId = category.id;
  }, 60000);

  afterAll(async () => {
    if (created.length) {
      await e2e.sql('DELETE FROM directory.reviews WHERE entity_id IN (:ids)', { ids: created });
      await e2e.sql('DELETE FROM directory.entity_payment_configs WHERE entity_id IN (:ids)', { ids: created });
      await e2e.sql('DELETE FROM directory.entity_plans WHERE entity_id IN (:ids)', { ids: created });
      await e2e.sql('DELETE FROM directory.entities WHERE id IN (:ids)', { ids: created });
    }
    await e2e.app.close();
  });

  it('D1: a person cannot create a listing, and nobody sets is_verified or the gym from the body', async () => {
    const person = await e2e.register('d1-person');
    const body = { name: 'Gimnasio Falso', entity_type: 'GYM', description: 'Una ficha creada por cualquiera.', primary_category_id: categoryId };
    const refused = await e2e.as(person.token).post('/directory/entities').send({ ...body, is_verified: true, tenant_id: 'default' });
    expect(refused.status).toBe(403);

    const admin = await e2e.platformAdmin('d1-admin');
    const smuggled = await e2e.as(admin.token).post('/directory/entities').send({ ...body, is_verified: true });
    expect(smuggled.status).toBe(400);
    const seeded = await e2e.as(admin.token).post('/directory/entities').send(body).expect(201);
    created.push(seeded.body.data.id as string);
    expect(seeded.body.data.isVerified).toBe(false);
    expect(seeded.body.data.tenantId).toBeNull();
  });

  it('D3: reviewing a gym listing linked to a tenant works (it failed with a SQL error)', async () => {
    const author = await e2e.register('d3-author');
    const entityId = await insertEntity({ tenantId: 'default' });
    const response = await e2e.as(author.token).post(`/directory/entities/${entityId}/reviews`).send(review);
    expect(response.status).toBe(201);
    // No membership nor granted entry at that gym: no seal.
    expect(response.body.data.isVerifiedAthlete).toBe(false);
  });

  it('D2: only the owner (or REPP) answers a review; a legacy gym ADMIN does not', async () => {
    const owner = await e2e.register('d2-owner');
    const author = await e2e.register('d2-author');
    const legacyAdmin = await e2e.register('d2-admin');
    await e2e.promote(legacyAdmin.id, 'ADMIN');
    const entityId = await insertEntity({ tenantId: 'default', userId: owner.id });
    const posted = await e2e.as(author.token).post(`/directory/entities/${entityId}/reviews`).send(review).expect(201);
    const reviewId = posted.body.data.id as string;
    await e2e.as(legacyAdmin.token).post(`/directory/reviews/${reviewId}/reply`).send({ reply_text: 'Respuesta falsa' }).expect(403);
    await e2e.as(owner.token).post(`/directory/reviews/${reviewId}/reply`).send({ reply_text: 'Gracias por venir' }).expect(201);
  });

  it("D12: someone else's review answers 404 to edit and delete", async () => {
    const author = await e2e.register('d12-author');
    const stranger = await e2e.register('d12-stranger');
    const entityId = await insertEntity();
    const posted = await e2e.as(author.token).post(`/directory/entities/${entityId}/reviews`).send(review).expect(201);
    const reviewId = posted.body.data.id as string;
    await e2e.as(stranger.token).patch(`/directory/reviews/${reviewId}`).send({ rating: 1 }).expect(404);
    await e2e.as(stranger.token).del(`/directory/reviews/${reviewId}`).expect(404);
  });

  it('D4/D5: public plan and payment data come mapped, without the tax id nor internal fields', async () => {
    const owner = await e2e.register('d45-owner');
    const entityId = await insertEntity({ userId: owner.id });
    const planId = await insertPlan(entityId);
    await e2e.sql(
      `INSERT INTO directory.entity_payment_configs (entity_id, bank_name, account_holder_name, tax_id, account_number, qr_image_url)
       VALUES (:entityId, 'Banco Union', 'Gimnasio E2E SRL', '1029384756', '1000-2000-3000', 'https://example.test/qr.png')`,
      { entityId },
    );
    const http = e2e.as('');
    const config = await http.get(`/public/directory/entities/${entityId}/payment-config`).expect(200);
    expect(config.body.data).toMatchObject({ bankName: 'Banco Union', accountNumber: '1000-2000-3000' });
    expect(config.body.data).not.toHaveProperty('taxId');
    expect(config.body.data).not.toHaveProperty('entityId');

    const plan = await http.get(`/public/directory/plans/${planId}`).expect(200);
    expect(plan.body.data.metadata).toEqual({});
    expect(plan.body.data).not.toHaveProperty('createdAt');
    expect(plan.body.data.entity ?? {}).not.toHaveProperty('userId');
    const plans = await http.get(`/public/directory/entities/${entityId}/plans`).expect(200);
    expect(plans.body.data[0].metadata).toEqual({});
  });

  it('D7: a suspended seller sells nothing', async () => {
    const entityId = await insertEntity({ status: 'SUSPENDED' });
    const planId = await insertPlan(entityId);
    const http = e2e.as('');
    const market = await http.get('/public/directory/plans?limit=100').expect(200);
    expect((market.body.data as { id: string }[]).map((item) => item.id)).not.toContain(planId);
    await http.get(`/public/directory/plans/${planId}`).expect(404);
    await http.get(`/public/directory/entities/${entityId}/plans`).expect(404);
    const buyer = await e2e.register('d7-buyer');
    await e2e.as(buyer.token).post('/directory/payments/orders').send({ planId }).expect(404);
  });

  it('D8: a plan priced without a currency is in BOB', async () => {
    const entityId = await insertEntity();
    const planId = await insertPlan(entityId);
    const [row] = await sequelize.query<{ currency: string }>('SELECT currency FROM directory.entity_plans WHERE id = :planId', {
      type: QueryTypes.SELECT,
      replacements: { planId },
    });
    expect(row.currency.trim()).toBe('BOB');
  });
});
