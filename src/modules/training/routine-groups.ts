import { DomainException } from '../../common/errors/domain.exception';
import type { RoutineGroupType } from './routine-exercise.model';

type GroupedExercise = {
  group: number | null;
  groupType?: RoutineGroupType | null;
  restBetweenSeconds: number | null;
};

/** 2 ejercicios = superserie; 3 o más = circuito. */
export function groupTypeFor(size: number): RoutineGroupType {
  return size >= 3 ? 'CIRCUITO' : 'SUPERSERIE';
}

/**
 * Valida y normaliza los bloques (superserie/circuito) de UN día, en el orden
 * de la lista:
 * - un `grupo` debe tener al menos 2 ejercicios y ser contiguo;
 * - los números se renumeran 1, 2, 3… por orden de aparición, así la huella no
 *   depende de qué número eligió el cliente;
 * - `grupoTipo` se deriva del tamaño y `descansoEntreSeg` solo vale dentro de un bloque.
 *
 * Lanza 400 `ROUTINE_GROUP_INVALID` si un bloque no es válido.
 */
export function normalizeDayGroups<T extends GroupedExercise>(
  exercises: readonly T[],
  dayLabel?: string,
): Array<T & { groupType: RoutineGroupType | null }> {
  const sizes = new Map<number, number>();
  const seenClosed = new Set<number>();
  let previous: number | null = null;
  for (const e of exercises) {
    const g = e.group;
    if (g != null) {
      if (g !== previous && (sizes.has(g) || seenClosed.has(g))) {
        throw invalid('Los ejercicios de un bloque deben ir seguidos.', g, dayLabel);
      }
      sizes.set(g, (sizes.get(g) ?? 0) + 1);
    }
    if (previous != null && previous !== g) seenClosed.add(previous);
    previous = g;
  }
  for (const [g, size] of sizes) {
    if (size < 2) throw invalid('Un bloque necesita al menos 2 ejercicios.', g, dayLabel);
  }

  const renumber = new Map<number, number>();
  for (const e of exercises) {
    if (e.group != null && !renumber.has(e.group)) renumber.set(e.group, renumber.size + 1);
  }
  return exercises.map((e) => {
    if (e.group == null) return { ...e, group: null, groupType: null, restBetweenSeconds: null };
    return { ...e, group: renumber.get(e.group) ?? null, groupType: groupTypeFor(sizes.get(e.group) ?? 0) };
  });
}

function invalid(message: string, group: number, dayLabel?: string): DomainException {
  return new DomainException(400, 'ROUTINE_GROUP_INVALID', message, {
    grupo: group,
    ...(dayLabel ? { dia: dayLabel } : {}),
  });
}
