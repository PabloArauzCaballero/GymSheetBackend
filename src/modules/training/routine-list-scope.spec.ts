import { Op } from 'sequelize';
import { RoutineStatus, RoutineVisibility, TrainingGoal } from '../../common/enums/domain.enums';
import { env } from '../../config/env';
import { routineWhereForScope } from './training.repository';

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
});
