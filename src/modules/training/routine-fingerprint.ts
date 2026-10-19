import { createHash } from 'node:crypto';

export type FingerprintExercise = {
  exerciseId: string;
  order: number;
  targetSets: number;
  repsMin: number | null;
  repsMax: number | null;
  /** Bloque (superserie/circuito) ya normalizado 1, 2… dentro del día. */
  group?: number | null;
  durationSeconds?: number | null;
};

export type FingerprintDay = {
  weekday: number | null;
  exercises: readonly FingerprintExercise[];
};

/**
 * Huella de una rutina para impedir publicar dos iguales (D1/DD-5).
 *
 * Entra: días, ejercicios, su posición dentro del día, series y rango de reps.
 * No entra: nombre, descripción, objetivo, peso, RIR, descanso, notas ni
 * duración en semanas. Sí entran el bloque (superserie) y la duración de la
 * serie. Usa la POSICIÓN y no el valor de `orden` (que es único por rutina y
 * puede tener huecos), así dos rutinas con los mismos ejercicios en el mismo
 * orden dan la misma huella aunque sus `orden` difieran.
 *
 * El texto canónico es idéntico al que calcula la migración
 * 202610100001-routine-groups-copies-session-targets (`FINGERPRINT_SQL_V2`):
 * una línea por día, `dia|ejercicio:posicion:series:repsMin:repsMax[:grupo:duracion],…`,
 * con `x` para «cualquier día». El sufijo `:grupo:duracion` solo aparece si
 * alguno de los dos tiene valor: un ejercicio sin bloque ni duración da el
 * mismo token que la versión de 202610080001, así las huellas antiguas no cambian.
 */
export function canonicalRoutineText(days: readonly FingerprintDay[]): string {
  return [...days]
    .sort((a, b) => (a.weekday ?? 99) - (b.weekday ?? 99))
    .map((day) => {
      const sorted = [...day.exercises].sort((a, b) => a.order - b.order);
      const body = sorted
        .map(
          (e, index) =>
            `${e.exerciseId}:${index + 1}:${e.targetSets}:${e.repsMin ?? ''}:${e.repsMax ?? ''}` +
            groupSuffix(e),
        )
        .join(',');
      return `${day.weekday ?? 'x'}|${body}`;
    })
    .join('\n');
}

function groupSuffix(e: FingerprintExercise): string {
  if (e.group == null && e.durationSeconds == null) return '';
  return `:${e.group ?? ''}:${e.durationSeconds ?? ''}`;
}

export function routineFingerprint(days: readonly FingerprintDay[]): string {
  return createHash('sha256').update(canonicalRoutineText(days), 'utf8').digest('hex');
}
