import {
  AccessDecisionOutcome,
  AccessDecisionReason,
  AccessDirection,
  AccessDeviceStatus,
  CredentialStatus,
  EmploymentStatus,
  MembershipStatus,
  UserStatus,
} from '../../common/enums/domain.enums';

export type AccessPolicyContext = {
  userStatus: UserStatus;
  credentialStatus: CredentialStatus;
  deviceStatus: AccessDeviceStatus;
  allowedDirection: AccessDirection;
  requestedDirection: AccessDirection.ENTRY | AccessDirection.EXIT;
  branchId: string;
  roomId: string | null;
  staff: { id: string; status: EmploymentStatus; unlimitedAccess: boolean; branchIds: string[] } | null;
  membership: { id: string; status: MembershipStatus; startsOn: string; endsOn: string; scope: { branchId: string; roomId: string | null }[] } | null;
  today: string;
  daysRemaining: number | null;
};

export type AccessPolicyResult = {
  outcome: AccessDecisionOutcome;
  reasonCode: AccessDecisionReason;
  membershipId: string | null;
  staffProfileId: string | null;
  daysRemaining: number | null;
};

const deny = (reasonCode: AccessDecisionReason): AccessPolicyResult => ({ outcome: AccessDecisionOutcome.DENIED, reasonCode, membershipId: null, staffProfileId: null, daysRemaining: null });

export function evaluateAccessPolicy(context: AccessPolicyContext): AccessPolicyResult {
  if (context.userStatus !== UserStatus.ACTIVE) return deny(AccessDecisionReason.USER_INACTIVE);
  if (context.credentialStatus !== CredentialStatus.ACTIVE) return deny(AccessDecisionReason.CREDENTIAL_INACTIVE);
  if (context.deviceStatus !== AccessDeviceStatus.ACTIVE) return deny(AccessDecisionReason.DEVICE_INACTIVE);
  if (context.allowedDirection !== AccessDirection.BOTH && context.allowedDirection !== context.requestedDirection) return deny(AccessDecisionReason.DIRECTION_NOT_ALLOWED);

  const staffHasScope = context.staff?.branchIds.includes(context.branchId) ?? false;
  if (context.staff?.status === EmploymentStatus.ACTIVE && context.staff.unlimitedAccess && staffHasScope) {
    return { outcome: AccessDecisionOutcome.GRANTED, reasonCode: AccessDecisionReason.STAFF_ACCESS, membershipId: null, staffProfileId: context.staff.id, daysRemaining: null };
  }

  if (!context.membership) return deny(AccessDecisionReason.MEMBERSHIP_NOT_FOUND);
  if (context.membership.status === MembershipStatus.SUSPENDED) return deny(AccessDecisionReason.MEMBERSHIP_SUSPENDED);
  if (context.membership.startsOn > context.today) return deny(AccessDecisionReason.MEMBERSHIP_NOT_STARTED);
  if (context.membership.endsOn < context.today) return deny(AccessDecisionReason.MEMBERSHIP_EXPIRED);
  if (context.membership.status !== MembershipStatus.ACTIVE) return deny(AccessDecisionReason.MEMBERSHIP_NOT_FOUND);

  const hasScope = context.membership.scope.some((scope) => scope.branchId === context.branchId && (scope.roomId === null || scope.roomId === context.roomId));
  if (!hasScope) return deny(AccessDecisionReason.ACCESS_SCOPE_DENIED);
  return { outcome: AccessDecisionOutcome.GRANTED, reasonCode: AccessDecisionReason.ACTIVE_MEMBERSHIP, membershipId: context.membership.id, staffProfileId: null, daysRemaining: context.daysRemaining };
}
