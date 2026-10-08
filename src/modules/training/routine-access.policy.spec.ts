import { RoutineVisibility, UserRole } from '../../common/enums/domain.enums';
import { AccessRoutine, canEditRoutine, canViewRoutine } from './routine-access.policy';

const owner = { id: 'owner', role: UserRole.CLIENT, tenantId: 'gym-a' };
const other = { id: 'other', role: UserRole.CLIENT, tenantId: 'gym-b' };
const routine = (over: Partial<AccessRoutine> = {}): AccessRoutine => ({
  createdByUserId: 'owner',
  visibility: RoutineVisibility.PRIVATE,
  moderationState: 'VISIBLE',
  authorTenantId: 'gym-a',
  ...over,
});

describe('canViewRoutine', () => {
  it('el autor siempre ve, incluso oculta por moderación', () => {
    expect(canViewRoutine(owner, routine({ moderationState: 'OCULTA_MODERACION' }), null)).toBe('FULL');
  });
  it('una pública visible la ve cualquiera, de cualquier gimnasio', () => {
    expect(canViewRoutine(other, routine({ visibility: RoutineVisibility.PUBLIC }), null)).toBe('FULL');
  });
  it('una pública oculta por moderación no la ve un tercero', () => {
    expect(
      canViewRoutine(other, routine({ visibility: RoutineVisibility.PUBLIC, moderationState: 'OCULTA_AUTO' }), null),
    ).toBe('NONE');
  });
  it('una privada ajena es invisible', () => {
    expect(canViewRoutine(other, routine(), null)).toBe('NONE');
  });
  it('con invitación pendiente solo ve la tarjeta', () => {
    expect(canViewRoutine(other, routine(), 'PENDING')).toBe('INVITATION_ONLY');
  });
  it('con invitación aceptada ve todo', () => {
    expect(canViewRoutine(other, routine(), 'ACCEPTED')).toBe('FULL');
  });
  it('rechazada o revocada vuelve a ser invisible', () => {
    expect(canViewRoutine(other, routine(), 'DECLINED')).toBe('NONE');
    expect(canViewRoutine(other, routine(), 'REVOKED')).toBe('NONE');
  });
  it('compartida y aceptada pero oculta por moderación: invisible', () => {
    expect(canViewRoutine(other, routine({ moderationState: 'OCULTA_MODERACION' }), 'ACCEPTED')).toBe('NONE');
  });
  it('asignación del entrenador equivale a aceptada', () => {
    expect(canViewRoutine(other, routine(), null, true)).toBe('FULL');
  });
  it('SYSTEM_ADMIN ve todo', () => {
    expect(canViewRoutine({ id: 's', role: UserRole.SYSTEM_ADMIN }, routine(), null)).toBe('FULL');
  });
  it('ADMIN ve las privadas de su gimnasio y no las de otro', () => {
    expect(canViewRoutine({ id: 'a', role: UserRole.ADMIN, tenantId: 'gym-a' }, routine(), null)).toBe('FULL');
    expect(canViewRoutine({ id: 'a', role: UserRole.ADMIN, tenantId: 'gym-b' }, routine(), null)).toBe('NONE');
  });
});

describe('canEditRoutine', () => {
  it('edita el autor, no un tercero', () => {
    expect(canEditRoutine(owner, routine())).toBe(true);
    expect(canEditRoutine(other, routine())).toBe(false);
  });
  it('una oficial solo la edita SYSTEM_ADMIN, ni siquiera su autor', () => {
    expect(canEditRoutine(owner, { ...routine(), isOfficial: true })).toBe(false);
    expect(canEditRoutine({ id: 's', role: UserRole.SYSTEM_ADMIN }, { ...routine(), isOfficial: true })).toBe(true);
  });
  it('ADMIN edita las de su gimnasio', () => {
    expect(canEditRoutine({ id: 'a', role: UserRole.ADMIN, tenantId: 'gym-a' }, routine())).toBe(true);
    expect(canEditRoutine({ id: 'a', role: UserRole.ADMIN, tenantId: 'gym-b' }, routine())).toBe(false);
  });
});
