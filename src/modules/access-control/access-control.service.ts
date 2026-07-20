import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { UniqueConstraintError } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import { QueueItemStatus } from '../../common/enums/domain.enums';
import { BusinessDateService } from '../../common/time/business-date.service';
import { env } from '../../config/env';
import { GymDomainEvent } from '../integration/domain-event.catalog';
import { DomainEventPublisher } from '../integration/domain-event.publisher';
import { MembershipRepository } from '../membership/membership.repository';
import { mapDecision, mapDevice, mapEvent } from './access-control.mapper';
import { AccessControlRepository } from './access-control.repository';
import {
  AccessHistoryFilterInput,
  CanonicalAccessEventInput,
  CreateDeviceInput,
  UpdateDeviceStatusInput,
} from './access-control.schemas';
import { evaluateAccessPolicy } from './access-policy.evaluator';

@Injectable()
export class AccessControlService {
  constructor(
    private readonly repository: AccessControlRepository,
    private readonly membershipRepository: MembershipRepository,
    private readonly events: DomainEventPublisher,
    private readonly dates: BusinessDateService,
    private readonly sequelize: Sequelize,
  ) {}

  async createDevice(input: CreateDeviceInput) {
    return mapDevice(await this.repository.createDevice(input));
  }

  async listDevices() {
    return (await this.repository.listDevices()).map(mapDevice);
  }

  async updateDeviceStatus(id: string, input: UpdateDeviceStatusInput) {
    const device = await this.repository.findDevice(id);
    if (!device) throw new NotFoundException('Dispositivo no encontrado.');
    await device.update(input);
    return mapDevice(device);
  }

  async enqueueAuthenticatedEvent(input: CanonicalAccessEventInput) {
    try {
      const event = await this.sequelize.transaction(async (transaction) => {
        const device = await this.repository.findDevice(
          input.deviceId,
          transaction,
        );
        const credential = await this.repository.findCredential(
          input.credentialId,
          transaction,
        );
        if (!device || !credential) {
          throw new UnprocessableEntityException(
            'Dispositivo o credencial no existe.',
          );
        }
        return this.repository.createEvent(input, transaction);
      });
      return mapEvent(event);
    } catch (error: unknown) {
      if (error instanceof UniqueConstraintError) {
        const existing = await this.repository.findEventBySource(
          input.deviceId,
          input.sourceEventId,
        );
        if (!existing) throw error;
        return mapEvent(existing);
      }
      throw error;
    }
  }

  async processEvent(
    eventId: string,
    workerId: string,
    attemptCount: number,
  ) {
    const decision = await this.sequelize.transaction(async (transaction) => {
      const event = await this.repository.findEvent(eventId, transaction);
      if (!event?.device?.accessPoint || !event.credential?.user) {
        throw new NotFoundException(
          'Evento de acceso incompleto o no encontrado.',
        );
      }
      this.assertWorkerLease(event, workerId, attemptCount);

      const existingDecision =
        event.decision ??
        (await this.repository.findDecisionByEvent(eventId, transaction));
      if (existingDecision) {
        await this.completeOrRejectStaleLease(
          event.id,
          workerId,
          attemptCount,
          transaction,
        );
        return existingDecision;
      }

      const user = event.credential.user;
      const point = event.device.accessPoint;
      const today = this.dates.today();
      const staff = await this.membershipRepository.findStaffByUserId(
        user.id,
        transaction,
      );
      const membership = await this.membershipRepository.findCurrentMembership(
        user.id,
        today,
        transaction,
      );
      const result = evaluateAccessPolicy({
        userStatus: user.status,
        credentialStatus: event.credential.status,
        deviceStatus: event.device.status,
        allowedDirection: point.allowedDirection,
        requestedDirection: event.requestedDirection,
        branchId: point.branchId,
        roomId: point.roomId,
        staff: staff
          ? {
              id: staff.id,
              status: staff.employmentStatus,
              unlimitedAccess: staff.unlimitedAccess,
              branchIds: (staff.branchScopes ?? []).map(
                (scope) => scope.branchId,
              ),
            }
          : null,
        membership: membership
          ? {
              id: membership.id,
              status: membership.status,
              startsOn: membership.startsOn,
              endsOn: membership.endsOn,
              scope: (membership.plan?.accessScopes ?? []).map((scope) => ({
                branchId: scope.branchId,
                roomId: scope.roomId,
              })),
            }
          : null,
        today,
        daysRemaining: membership
          ? Math.max(0, this.dates.daysBetween(today, membership.endsOn))
          : null,
      });

      const created = await this.repository.createDecision(
        {
          deviceEventId: event.id,
          userId: user.id,
          ...result,
          policyVersion: env.ACCESS_POLICY_VERSION,
        },
        transaction,
      );
      await this.events.record(
        {
          eventName: GymDomainEvent.ACCESS_DECISION_RECORDED,
          aggregateType: 'access_decision',
          aggregateId: created.id,
          deduplicationKey: `access.decision-recorded:${event.id}`,
          correlationId: event.sourceEventId,
          payload: {
            deviceEventId: event.id,
            decisionId: created.id,
            userId: user.id,
            direction: event.requestedDirection,
            outcome: result.outcome,
            reasonCode: result.reasonCode,
          },
          metadata: {
            deviceId: event.deviceId,
            policyVersion: env.ACCESS_POLICY_VERSION,
          },
        },
        transaction,
      );
      await this.completeOrRejectStaleLease(
        event.id,
        workerId,
        attemptCount,
        transaction,
      );
      return created;
    });

    return mapDecision(decision);
  }

  async getEvent(id: string) {
    const event = await this.repository.findEvent(id);
    if (!event) throw new NotFoundException('Evento no encontrado.');
    return mapEvent(event);
  }

  async listHistory(filters: AccessHistoryFilterInput, forcedUserId?: string) {
    const result = await this.repository.listDecisions(filters, forcedUserId);
    return {
      items: result.rows.map(mapDecision),
      page: filters.page,
      pageSize: filters.pageSize,
      total: result.count,
      totalPages: Math.ceil(result.count / filters.pageSize),
    };
  }

  private assertWorkerLease(
    event: { queueStatus: QueueItemStatus; lockedBy: string | null; attemptCount: number },
    workerId: string,
    attemptCount: number,
  ) {
    if (
      event.queueStatus !== QueueItemStatus.PROCESSING ||
      event.lockedBy !== workerId ||
      event.attemptCount !== attemptCount
    ) {
      throw new ConflictException('La concesión del worker ya no es válida.');
    }
  }

  private async completeOrRejectStaleLease(
    eventId: string,
    workerId: string,
    attemptCount: number,
    transaction: Parameters<AccessControlRepository['completeClaimedEvent']>[3],
  ) {
    const completed = await this.repository.completeClaimedEvent(
      eventId,
      workerId,
      attemptCount,
      transaction,
    );
    if (!completed) {
      throw new ConflictException('La concesión del worker fue reemplazada.');
    }
  }
}
