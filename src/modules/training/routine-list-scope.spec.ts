import { literal, Op } from 'sequelize';
import { RoutineStatus, RoutineVisibility, TrainingGoal } from '../../common/enums/domain.enums';
import { env } from '../../config/env';
import { routineAuthorTenantSql, routineDiscoverableSql } from './routine-discovery';
import { ROUTINE_LIST_ALIAS, routineListReplacements, routineWhereForScope } from './training.repository';

/** Legacy page-based `GET /routines` (installed apps): what each scope may list. */
describe('routineWhereForScope', () => {
  const original = env.CATALOG_HIDDEN_NAME_PREFIX;
  afterEach(() => {
    env.CATALOG_HIDDEN_NAME_PREFIX = original;
  });

  it('mine lists only the caller’s active routines, optionally by goal', () => {
    expect(routineWhereForScope('mine', 'u1')).toEqual({ createdByUserId: 'u1', status: RoutineStatus.ACTIVE });
    expect(routineWhereForScope('mine', 'u1', TrainingGoal.STRENGTH)).toEqual({
      createdByUserId: 'u1', status: RoutineStatus.ACTIVE, goal: TrainingGoal.STRENGTH,
    });
  });

  it('public/templates list published, visible, active routines (officials included, as Explorar expected)', () => {
    env.CATALOG_HIDDEN_NAME_PREFIX = undefined;
    const expected = {
      visibility: { [Op.in]: [RoutineVisibility.PUBLIC, RoutineVisibility.TEMPLATE] },
      status: RoutineStatus.ACTIVE,
      moderationState: 'VISIBLE',
      [Op.and]: [literal(routineDiscoverableSql(ROUTINE_LIST_ALIAS))],
    };
    expect(routineWhereForScope('public', 'u1')).toEqual(expected);
    expect(routineWhereForScope('templates', 'u1')).toEqual(expected);
    expect(routineWhereForScope('public', 'u1', TrainingGoal.STRENGTH)).toEqual({ ...expected, goal: TrainingGoal.STRENGTH });
  });

  it('hides automated-test routines by CATALOG_HIDDEN_NAME_PREFIX, escaping LIKE wildcards', () => {
    env.CATALOG_HIDDEN_NAME_PREFIX = 'smoke_%';
    expect(routineWhereForScope('public', 'u1')).toMatchObject({ name: { [Op.notLike]: 'smoke\\_\\%%' } });
    expect(routineWhereForScope('templates', 'u1')).toMatchObject({ name: { [Op.notLike]: 'smoke\\_\\%%' } });
    expect(routineWhereForScope('mine', 'u1')).not.toHaveProperty('name');
  });

  it('mine is not narrowed by the discovery rule (own routines, any gym)', () => {
    expect(routineWhereForScope('mine', 'u1')).not.toHaveProperty([Op.and]);
  });

  it('binds the viewer and the default gym as replacements, never interpolated', () => {
    const original = env.DEFAULT_TENANT_ID;
    env.DEFAULT_TENANT_ID = 'repp';
    try {
      expect(routineListReplacements({ id: 'u1', tenantId: 'gym-a' })).toEqual({
        viewerId: 'u1', viewerTenantId: 'gym-a', defaultTenantId: 'repp',
      });
    } finally {
      env.DEFAULT_TENANT_ID = original;
    }
  });
});

/** The discovery rule shared by the legacy page list and the cursor catalog. */
describe('routineDiscoverableSql', () => {
  const sql = routineDiscoverableSql('r').replace(/\s+/gu, ' ');

  it('hides routines the viewer reported', () => {
    expect(sql).toContain(
      "NOT EXISTS ( SELECT 1 FROM moderation.reports rep WHERE rep.reporter_user_id = :viewerId AND rep.target_kind = 'ROUTINE' AND rep.target_id = r.id)",
    );
  });

  it('hides routines whose author blocked the viewer or was blocked by them', () => {
    expect(sql).toContain('(blk.blocker_id = :viewerId AND blk.blocked_id = r.created_by_user_id)');
    expect(sql).toContain('(blk.blocker_id = r.created_by_user_id AND blk.blocked_id = :viewerId)');
  });

  it('keeps officials platform-wide and limits community routines to the gym unless the author consented', () => {
    expect(sql).toContain("r.es_oficial = true OR r.visibilidad = 'TEMPLATE' OR r.created_by_user_id = :viewerId");
    expect(sql).toContain('= :viewerTenantId');
    expect(sql).toContain(':defaultTenantId');
    expect(sql).toContain('ps.profile_enabled AND ps.cross_gym_enabled');
  });

  it('cross-gym authors must be active, not suspended adults, like the social directory', () => {
    expect(sql).toContain("cu.estado = 'ACTIVO'");
    expect(sql).toContain('(cu.suspended_until IS NULL OR cu.suspended_until <= NOW())');
    expect(sql).toContain('COALESCE(EXTRACT(YEAR FROM age(CURRENT_DATE, cp.fecha_nacimiento))::int, cp.edad, 0) >= 18');
  });

  it('resolves the author gym with the session fallbacks (routine, account, default)', () => {
    expect(routineAuthorTenantSql('r').replace(/\s+/gu, ' ')).toBe(
      'COALESCE(r.tenant_id_autor, (SELECT au.tenant_id FROM public.usuarios au WHERE au.id = r.created_by_user_id), :defaultTenantId)',
    );
  });

  it('only references bound parameters for viewer data', () => {
    expect(sql.match(/(?<![:\w]):[a-zA-Z]+/gu)?.sort()).toEqual(
      [':defaultTenantId', ':viewerId', ':viewerId', ':viewerId', ':viewerId', ':viewerTenantId'].sort(),
    );
  });
});
