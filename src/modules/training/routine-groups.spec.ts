import { DomainException } from '../../common/errors/domain.exception';
import { normalizeDayGroups } from './routine-groups';

const e = (id: string, group: number | null, restBetweenSeconds: number | null = null) => ({ id, group, restBetweenSeconds });

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (error) {
    return error instanceof DomainException ? error.code : 'OTHER';
  }
  return undefined;
}

describe('normalizeDayGroups', () => {
  it('2 ejercicios = SUPERSERIE y 3 = CIRCUITO', () => {
    const out = normalizeDayGroups([e('a', 1), e('b', 1), e('c', 2), e('d', 2), e('f', 2)]);
    expect(out.map((x) => x.groupType)).toEqual(['SUPERSERIE', 'SUPERSERIE', 'CIRCUITO', 'CIRCUITO', 'CIRCUITO']);
  });
  it('renumera los bloques por orden de aparición', () => {
    const out = normalizeDayGroups([e('x', null), e('a', 7), e('b', 7), e('c', 3), e('d', 3)]);
    expect(out.map((x) => x.group)).toEqual([null, 1, 1, 2, 2]);
  });
  it('sin grupo no hay tipo ni descanso entre ejercicios', () => {
    const [out] = normalizeDayGroups([e('a', null, 15)]);
    expect(out).toMatchObject({ group: null, groupType: null, restBetweenSeconds: null });
  });
  it('conserva el descanso entre ejercicios dentro del bloque', () => {
    expect(normalizeDayGroups([e('a', 1, 15), e('b', 1, 15)])[0].restBetweenSeconds).toBe(15);
  });
  it('un bloque de 1 ejercicio es ROUTINE_GROUP_INVALID', () => {
    expect(codeOf(() => normalizeDayGroups([e('a', 1), e('b', null)]))).toBe('ROUTINE_GROUP_INVALID');
  });
  it('un bloque no contiguo es ROUTINE_GROUP_INVALID', () => {
    expect(codeOf(() => normalizeDayGroups([e('a', 1), e('b', null), e('c', 1)]))).toBe('ROUTINE_GROUP_INVALID');
    expect(codeOf(() => normalizeDayGroups([e('a', 1), e('b', 2), e('c', 2), e('d', 1)]))).toBe('ROUTINE_GROUP_INVALID');
  });
  it('admite el mismo ejercicio dos veces en el día', () => {
    expect(normalizeDayGroups([e('a', 1), e('a', 1), e('a', null)])).toHaveLength(3);
  });
});
