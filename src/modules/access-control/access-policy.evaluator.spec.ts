import { AccessDecisionOutcome, AccessDecisionReason, AccessDirection, AccessDeviceStatus, CredentialStatus, EmploymentStatus, MembershipStatus, UserStatus } from '../../common/enums/domain.enums';
import { AccessPolicyContext, evaluateAccessPolicy } from './access-policy.evaluator';

const base: AccessPolicyContext = {
  userStatus: UserStatus.ACTIVE,
  credentialStatus: CredentialStatus.ACTIVE,
  deviceStatus: AccessDeviceStatus.ACTIVE,
  allowedDirection: AccessDirection.BOTH,
  requestedDirection: AccessDirection.ENTRY,
  branchId: 'branch-1',
  roomId: null,
  staff: null,
  membership: { id: 'membership-1', status: MembershipStatus.ACTIVE, startsOn: '2026-07-01', endsOn: '2026-07-31', scope: [{ branchId: 'branch-1', roomId: null }] },
  today: '2026-07-19',
  daysRemaining: 12,
};

describe('evaluateAccessPolicy', () => {
  it('grants an active scoped membership', () => {
    expect(evaluateAccessPolicy(base)).toMatchObject({ outcome: AccessDecisionOutcome.GRANTED, reasonCode: AccessDecisionReason.ACTIVE_MEMBERSHIP, daysRemaining: 12 });
  });

  it('denies an expired membership', () => {
    const result = evaluateAccessPolicy({ ...base, membership: { ...base.membership!, endsOn: '2026-07-18' } });
    expect(result.reasonCode).toBe(AccessDecisionReason.MEMBERSHIP_EXPIRED);
  });

  it('grants active staff without a membership', () => {
    const result = evaluateAccessPolicy({ ...base, membership: null, staff: { id: 'staff-1', status: EmploymentStatus.ACTIVE, unlimitedAccess: true, branchIds: ['branch-1'] } });
    expect(result.reasonCode).toBe(AccessDecisionReason.STAFF_ACCESS);
  });

  it('denies inactive staff when no membership exists', () => {
    const result = evaluateAccessPolicy({ ...base, membership: null, staff: { id: 'staff-1', status: EmploymentStatus.TERMINATED, unlimitedAccess: true, branchIds: ['branch-1'] } });
    expect(result.reasonCode).toBe(AccessDecisionReason.MEMBERSHIP_NOT_FOUND);
  });

  it('denies a direction not supported by the access point', () => {
    const result = evaluateAccessPolicy({ ...base, allowedDirection: AccessDirection.EXIT });
    expect(result.reasonCode).toBe(AccessDecisionReason.DIRECTION_NOT_ALLOWED);
  });
});
