import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { QueryTypes, Transaction } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import { QueueItemStatus } from '../../common/enums/domain.enums';
import { AccessPointModel } from '../facilities/access-point.model';
import { UserModel } from '../users/user.model';
import { AccessCredentialModel } from './access-credential.model';
import { AccessDecisionModel } from './access-decision.model';
import { AccessDeviceEventModel } from './access-device-event.model';
import { AccessDeviceModel } from './access-device.model';
import {
  AccessHistoryFilterInput,
  CanonicalAccessEventInput,
  CreateDeviceInput,
} from './access-control.schemas';

export type FailedAccessEventUpdate = {
  deadLetter: boolean;
  updated: boolean;
};

@Injectable()
export class AccessControlRepository {
  constructor(
    @InjectModel(AccessCredentialModel)
    private readonly credentials: typeof AccessCredentialModel,
    @InjectModel(AccessDeviceModel)
    private readonly devices: typeof AccessDeviceModel,
    @InjectModel(AccessDeviceEventModel)
    private readonly events: typeof AccessDeviceEventModel,
    @InjectModel(AccessDecisionModel)
    private readonly decisions: typeof AccessDecisionModel,
    private readonly sequelize: Sequelize,
  ) {}

  findCredential(id: string, transaction?: Transaction) {
    return this.credentials.findByPk(id, {
      include: [UserModel],
      transaction,
      lock: transaction ? transaction.LOCK.UPDATE : undefined,
    });
  }

  createDevice(input: CreateDeviceInput) {
    return this.devices.create(input);
  }

  findDevice(id: string, transaction?: Transaction) {
    return this.devices.findByPk(id, {
      include: [AccessPointModel],
      transaction,
      lock: transaction ? transaction.LOCK.UPDATE : undefined,
    });
  }

  listDevices() {
    return this.devices.findAll({
      include: [AccessPointModel],
      order: [['name', 'ASC']],
    });
  }

  createEvent(input: CanonicalAccessEventInput, transaction: Transaction) {
    return this.events.create(input, { transaction });
  }

  findEventBySource(
    deviceId: string,
    sourceEventId: string,
    transaction?: Transaction,
  ) {
    return this.events.findOne({
      where: { deviceId, sourceEventId },
      include: [AccessDecisionModel],
      transaction,
    });
  }

  findEvent(id: string, transaction?: Transaction) {
    return this.events.findByPk(id, {
      include: [
        { model: AccessDeviceModel, include: [AccessPointModel] },
        { model: AccessCredentialModel, include: [UserModel] },
        AccessDecisionModel,
      ],
      transaction,
      lock: transaction ? transaction.LOCK.UPDATE : undefined,
    });
  }

  async claimEvents(
    workerId: string,
    limit: number,
    lockTimeoutMilliseconds: number,
  ): Promise<AccessDeviceEventModel[]> {
    return this.sequelize.transaction(async (transaction) => {
      const claimedRows = await this.sequelize.query<{ id: string }>(
        `WITH candidates AS (
           SELECT id
           FROM access_control.device_events
           WHERE available_at <= now()
             AND (
               queue_status IN ('PENDING', 'FAILED')
               OR (
                 queue_status = 'PROCESSING'
                 AND locked_at < now() - (:lockTimeoutMilliseconds * interval '1 millisecond')
               )
             )
           ORDER BY received_at ASC
           FOR UPDATE SKIP LOCKED
           LIMIT :limit
         )
         UPDATE access_control.device_events event
         SET queue_status = 'PROCESSING',
             attempt_count = event.attempt_count + 1,
             locked_at = now(),
             locked_by = :workerId,
             updated_at = now()
         FROM candidates
         WHERE event.id = candidates.id
         RETURNING event.id`,
        {
          replacements: {
            workerId,
            limit,
            lockTimeoutMilliseconds,
          },
          type: QueryTypes.SELECT,
          transaction,
        },
      );

      if (claimedRows.length === 0) return [];

      return this.events.findAll({
        where: { id: claimedRows.map(({ id }) => id) },
        order: [['receivedAt', 'ASC']],
        transaction,
      });
    });
  }

  async completeClaimedEvent(
    eventId: string,
    workerId: string,
    attemptCount: number,
    transaction: Transaction,
  ): Promise<boolean> {
    const [updatedRows] = await this.events.update(
      {
        queueStatus: QueueItemStatus.COMPLETED,
        completedAt: new Date(),
        lockedAt: null,
        lockedBy: null,
        lastError: null,
      },
      {
        where: {
          id: eventId,
          queueStatus: QueueItemStatus.PROCESSING,
          lockedBy: workerId,
          attemptCount,
        },
        transaction,
      },
    );
    return updatedRows === 1;
  }

  async markEventFailed(
    event: AccessDeviceEventModel,
    workerId: string,
    error: unknown,
    maximumAttempts: number,
  ): Promise<FailedAccessEventUpdate> {
    const deadLetter = event.attemptCount >= maximumAttempts;
    const delaySeconds = Math.min(
      300,
      2 ** Math.min(event.attemptCount, 8) * 2,
    );
    const errorMessage =
      error instanceof Error ? error.message : 'Unknown access worker error';
    const [updatedRows] = await this.events.update(
      {
        queueStatus: deadLetter
          ? QueueItemStatus.DEAD_LETTER
          : QueueItemStatus.FAILED,
        availableAt: new Date(Date.now() + delaySeconds * 1000),
        lockedAt: null,
        lockedBy: null,
        lastError: errorMessage.slice(0, 4000),
      },
      {
        where: {
          id: event.id,
          queueStatus: QueueItemStatus.PROCESSING,
          lockedBy: workerId,
          attemptCount: event.attemptCount,
        },
      },
    );

    return { deadLetter, updated: updatedRows === 1 };
  }

  createDecision(input: Record<string, unknown>, transaction: Transaction) {
    return this.decisions.create(input, { transaction });
  }

  findDecisionByEvent(eventId: string, transaction?: Transaction) {
    return this.decisions.findOne({
      where: { deviceEventId: eventId },
      transaction,
    });
  }

  listDecisions(filters: AccessHistoryFilterInput, forcedUserId?: string) {
    const where = {
      ...(forcedUserId
        ? { userId: forcedUserId }
        : filters.usuarioId
          ? { userId: filters.usuarioId }
          : {}),
      ...(filters.resultado ? { outcome: filters.resultado } : {}),
    };

    return this.decisions.findAndCountAll({
      where,
      limit: filters.pageSize,
      offset: (filters.page - 1) * filters.pageSize,
      order: [['decidedAt', 'DESC']],
    });
  }
}
