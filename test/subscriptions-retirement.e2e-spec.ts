import { randomUUID } from 'node:crypto';
import { QueryTypes, Transaction } from 'sequelize';
import { subscriptionLedgerMigration } from '../src/database/migrations/202611201001-subscription-ledger';
import { retireMembershipMachineryMigration } from '../src/database/migrations/202611201002-retire-membership-machinery';
import { gymMembershipVisibilityMigration } from '../src/database/migrations/202611201101-gym-membership-visibility';
import { KycHarness, bootKycHarness } from './support/kyc-e2e';
import { createListing } from './support/listings-e2e';
import { removeReceipts } from './support/orders-e2e';
import { GymSeller, cashOrder, confirmOrder, gymSeller, periodsOf, socioData } from './support/subscriptions-e2e';

/** The gym-operated membership routes and physical access left the product (ADR-0026). */
const REMOVED_PERSON_ROUTES = [
  ['get', '/membership/plans'],
  ['get', `/membership/plans/${randomUUID()}`],
  ['get', '/me/membership'],
  ['get', '/me/membership/options'],
  ['post', '/me/membership/renewal-intent'],
  ['post', '/me/membership/extension-intent'],
  ['post', '/me/membership/activation-request'],
  ['get', '/memberships/me'],
  ['get', '/me/accesses'],
  ['get', '/access/me'],
  ['get', '/access/credentials/me'],
] as const;
const REMOVED_ADMIN_ROUTES = [
  ['get', '/admin/membership/plans'],
  ['get', '/admin/membership/memberships'],
  ['get', '/admin/membership/insights/lapsed'],
  ['get', '/admin/membership/insights/people-flow'],
  ['get', '/admin/membership/activation/abc'],
  ['post', `/admin/membership/intents/${randomUUID()}/confirm`],
  ['get', '/admin/membership/staff'],
  ['get', '/admin/access/devices'],
  ['get', '/admin/access/history'],
  ['post', '/admin/access/credentials/pin'],
] as const;

describe('retirement of the gym-operated membership machinery (e2e, franja 8e)', () => {
  let h: KycHarness;
  let gym: GymSeller;

  beforeAll(async () => {
    h = await bootKycHarness();
    gym = await gymSeller(h, 'subr-gym');
  }, 180000);

  afterAll(async () => {
    await removeReceipts(h);
    await h.close();
  });

  it('the removed routes answer 404 to a person and to the platform admin', async () => {
    const person = await h.e2e.register('subr-person');
    const platform = await h.e2e.platformAdmin('subr-platform');
    for (const [method, path] of REMOVED_PERSON_ROUTES) await h.e2e.as(person.token)[method](path).send({}).expect(404);
    for (const [method, path] of REMOVED_ADMIN_ROUTES) await h.e2e.as(platform.token)[method](path).send({}).expect(404);
  });

  it('migrations 8e-1 and 8e-3 go down and up with legacy and marketplace rows, and every row survives the round trip', async () => {
    const person = await h.e2e.register('subr-migration');
    const membership = await cashOrder(h, person.token, { listingId: gym.listingId, affiliation: socioData(gym) });
    await confirmOrder(h, gym, membership.id).expect(200);
    const pack = await createListing(h, gym, { offerKind: 'CLASS_PACK', name: 'Pack ocho', description: 'Ocho clases de funcional.', price: 160, sessionsCount: 8 });
    const packOrder = await cashOrder(h, person.token, { listingId: pack.id });
    await confirmOrder(h, gym, packOrder.id).expect(200);
    const legacyPlan = randomUUID();
    const legacy = randomUUID();
    await h.e2e.sql(`INSERT INTO retired.membership_plans (id, code, name, duration_days) VALUES (:plan, :code, 'Plan heredado', 30)`, {
      plan: legacyPlan,
      code: `legacy-${legacyPlan.slice(0, 8)}`,
    });
    await h.e2e.sql(
      `INSERT INTO membership.memberships (id, user_id, retired_plan_id, starts_on, ends_on, offer_kind, plan_name, external_reference)
       VALUES (:id, :userId, :plan, CURRENT_DATE - 60, CURRENT_DATE - 31, 'MEMBERSHIP', 'Plan heredado', :ref)`,
      { id: legacy, userId: person.id, plan: legacyPlan, ref: `legacy-${legacy}` },
    );
    const snapshot = (transaction?: Transaction) =>
      h.sequelize.query(
        `SELECT id, user_id, starts_on::text, ends_on::text, status, external_reference, entity_id, entity_plan_id, payment_order_id,
                affiliation_id, offer_kind, plan_name, sessions_total, sessions_used, origin
           FROM membership.memberships WHERE user_id = :userId ORDER BY id`,
        { type: QueryTypes.SELECT, replacements: { userId: person.id }, transaction },
      );
    const before = await snapshot();
    expect(before).toHaveLength(3);
    const queryInterface = h.sequelize.getQueryInterface();
    const transaction = await h.sequelize.transaction();
    try {
      await gymMembershipVisibilityMigration.down(queryInterface, transaction);
      await retireMembershipMachineryMigration.down(queryInterface, transaction);
      await subscriptionLedgerMigration.down(queryInterface, transaction);
      const old = await h.sequelize.query<{ withPlan: number; plans: string | null; intents: string | null }>(
        `SELECT count(*) FILTER (WHERE plan_id IS NOT NULL AND ends_on IS NOT NULL)::int AS "withPlan",
                to_regclass('membership.plans')::text AS plans, to_regclass('membership.intents')::text AS intents
           FROM membership.memberships WHERE user_id = :userId`,
        { type: QueryTypes.SELECT, replacements: { userId: person.id }, transaction },
      );
      // The previous code finds every row with a plan and an end date, in its own schema.
      expect(old).toEqual([{ withPlan: 3, plans: 'membership.plans', intents: 'membership.intents' }]);
      await subscriptionLedgerMigration.up(queryInterface, transaction);
      await retireMembershipMachineryMigration.up(queryInterface, transaction);
      await gymMembershipVisibilityMigration.up(queryInterface, transaction);
      expect(await snapshot(transaction)).toEqual(before);
    } finally {
      await transaction.rollback();
    }
    const periods = await periodsOf(h, { userId: person.id });
    expect(periods.map((row) => [row.origin, row.offerKind])).toEqual(
      expect.arrayContaining([['LEGACY', 'MEMBERSHIP'], ['MARKETPLACE', 'MEMBERSHIP'], ['MARKETPLACE', 'CLASS_PACK']]),
    );
  });
});
