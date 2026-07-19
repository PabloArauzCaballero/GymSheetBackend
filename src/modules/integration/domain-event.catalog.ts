import {
  AccessDecisionOutcome,
  EmploymentStatus,
  MaintenanceStatus,
  MembershipStatus,
} from '../../common/enums/domain.enums';

export const GymDomainEvent = {
  CUSTOMER_REGISTERED: 'customer.registered.v1',
  STAFF_PROFILE_CREATED: 'staff.profile-created.v1',
  STAFF_STATUS_CHANGED: 'staff.employment-status-changed.v1',
  MEMBERSHIP_ACTIVATED: 'membership.activated.v1',
  MEMBERSHIP_STATUS_CHANGED: 'membership.status-changed.v1',
  EQUIPMENT_ASSIGNED: 'equipment.assigned-to-room.v1',
  MAINTENANCE_SCHEDULED: 'equipment.maintenance-scheduled.v1',
  MAINTENANCE_STARTED: 'equipment.maintenance-started.v1',
  MAINTENANCE_COMPLETED: 'equipment.maintenance-completed.v1',
  ACCESS_DECISION_RECORDED: 'access.decision-recorded.v1',
  NOTIFICATION_DELIVERY_REQUESTED: 'notification.delivery-requested.v1',
} as const;

export type GymDomainEventName =
  (typeof GymDomainEvent)[keyof typeof GymDomainEvent];

export type GymDomainEventPayloadMap = {
  [GymDomainEvent.CUSTOMER_REGISTERED]: {
    userId: string;
    customerProfileId: string;
    customerNumber: string;
    pinCredentialId: string;
  };
  [GymDomainEvent.STAFF_PROFILE_CREATED]: {
    userId: string;
    staffProfileId: string;
    branchIds: string[];
  };
  [GymDomainEvent.STAFF_STATUS_CHANGED]: {
    userId: string;
    staffProfileId: string;
    fromStatus: EmploymentStatus;
    toStatus: EmploymentStatus;
  };
  [GymDomainEvent.MEMBERSHIP_ACTIVATED]: {
    membershipId: string;
    userId: string;
    planId: string;
    startsOn: string;
    endsOn: string;
  };
  [GymDomainEvent.MEMBERSHIP_STATUS_CHANGED]: {
    membershipId: string;
    userId: string;
    fromStatus: MembershipStatus;
    toStatus: MembershipStatus;
    reason: string | null;
  };
  [GymDomainEvent.EQUIPMENT_ASSIGNED]: {
    equipmentId: string;
    assignmentId: string;
    previousRoomId: string | null;
    roomId: string;
  };
  [GymDomainEvent.MAINTENANCE_SCHEDULED]: {
    equipmentId: string;
    maintenanceEventId: string;
    scheduledFor: string;
  };
  [GymDomainEvent.MAINTENANCE_STARTED]: {
    equipmentId: string;
    maintenanceEventId: string;
    status: MaintenanceStatus.IN_PROGRESS;
  };
  [GymDomainEvent.MAINTENANCE_COMPLETED]: {
    equipmentId: string;
    maintenanceEventId: string;
    status: MaintenanceStatus.COMPLETED;
    nextServiceOn: string | null;
  };
  [GymDomainEvent.ACCESS_DECISION_RECORDED]: {
    deviceEventId: string;
    decisionId: string;
    userId: string;
    direction: 'ENTRY' | 'EXIT';
    outcome: AccessDecisionOutcome;
    reasonCode: string;
  };
  [GymDomainEvent.NOTIFICATION_DELIVERY_REQUESTED]: {
    notificationId: string;
    recipientUserId: string;
    channel: string;
  };
};

export type RecordGymDomainEventInput<TName extends GymDomainEventName> = {
  eventName: TName;
  aggregateType: string;
  aggregateId: string | null;
  deduplicationKey: string;
  actorUserId?: string | null;
  correlationId?: string | null;
  causationEventId?: string | null;
  traceId?: string | null;
  payload: GymDomainEventPayloadMap[TName];
  metadata?: Record<string, unknown>;
};
