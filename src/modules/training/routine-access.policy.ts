import { RoutineVisibility, UserRole } from '../../common/enums/domain.enums';

export type AccessUser = { id: string; role: UserRole };

export type AccessRoutine = {
  createdByUserId: string;
  visibility: RoutineVisibility;
  moderationState: 'VISIBLE' | 'OCULTA_AUTO' | 'OCULTA_MODERACION';
};

export type ShareState = 'PENDING' | 'ACCEPTED' | 'DECLINED' | 'REVOKED' | null;

/**
 * Qué puede hacer una persona con una rutina (01_DATOS §4).
 *
 * - `FULL`: ve días y ejercicios.
 * - `INVITATION_ONLY`: tiene una invitación pendiente; solo ve la tarjeta
 *   (nombre, autor, días), sin ejercicios.
 * - `NONE`: la API responde 404 (no confirma que exista).
 * `viewer` indica además si el autor ve su propia rutina oculta por moderación.
 */
export type RoutineView = 'FULL' | 'INVITATION_ONLY' | 'NONE';

export function canViewRoutine(
  user: AccessUser,
  routine: AccessRoutine,
  share: ShareState,
  hasCoachAssignment = false,
): RoutineView {
  if (routine.createdByUserId === user.id) return 'FULL';
  // A gym has no staff powers (ADR-0019): only the author and REPP see past the rules below.
  if (user.role === UserRole.SYSTEM_ADMIN) return 'FULL';
  const visible = routine.moderationState === 'VISIBLE';
  if (
    visible &&
    (routine.visibility === RoutineVisibility.PUBLIC ||
      routine.visibility === RoutineVisibility.TEMPLATE)
  ) {
    return 'FULL';
  }
  if (share === 'ACCEPTED' || hasCoachAssignment) return visible ? 'FULL' : 'NONE';
  if (share === 'PENDING') return 'INVITATION_ONLY';
  return 'NONE';
}

/** Only the author or a `SYSTEM_ADMIN` edits; official routines, only a `SYSTEM_ADMIN` (ADR-0019). */
export function canEditRoutine(
  user: AccessUser,
  routine: AccessRoutine & { isOfficial?: boolean },
): boolean {
  if (user.role === UserRole.SYSTEM_ADMIN) return true;
  if (routine.isOfficial) return false;
  return routine.createdByUserId === user.id;
}
