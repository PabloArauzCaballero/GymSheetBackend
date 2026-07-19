import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Transaction } from 'sequelize';
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

@Injectable()
export class AccessControlRepository {
  constructor(
    @InjectModel(AccessCredentialModel) private readonly credentials: typeof AccessCredentialModel,
    @InjectModel(AccessDeviceModel) private readonly devices: typeof AccessDeviceModel,
    @InjectModel(AccessDeviceEventModel) private readonly events: typeof AccessDeviceEventModel,
    @InjectModel(AccessDecisionModel) private readonly decisions: typeof AccessDecisionModel,
  ) {}

  findCredential(id: string, transaction?: Transaction) {
    return this.credentials.findByPk(id, {
      include: [UserModel],
      transaction,
      lock: transaction ? transaction.LOCK.UPDATE : undefined,
    });
  }

  createDevice(input: CreateDeviceInput) { return this.devices.create(input); }
  findDevice(id: string, transaction?: Transaction) {
    return this.devices.findByPk(id, {
      include: [AccessPointModel],
      transaction,
      lock: transaction ? transaction.LOCK.UPDATE : undefined,
    });
  }
  listDevices() { return this.devices.findAll({ include: [AccessPointModel], order: [['name', 'ASC']] }); }

  createEvent(input: CanonicalAccessEventInput, transaction: Transaction) {
    return this.events.create(input, { transaction });
  }
  findEventBySource(deviceId: string, sourceEventId: string, transaction?: Transaction) {
    return this.events.findOne({ where: { deviceId, sourceEventId }, include: [AccessDecisionModel], transaction });
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
  async updateEvent(event: AccessDeviceEventModel, changes: Record<string, unknown>, transaction: Transaction) {
    await event.update(changes, { transaction });
    return event;
  }
  createDecision(input: Record<string, unknown>, transaction: Transaction) {
    return this.decisions.create(input, { transaction });
  }
  findDecisionByEvent(eventId: string, transaction?: Transaction) {
    return this.decisions.findOne({ where: { deviceEventId: eventId }, transaction });
  }
  listDecisions(filters: AccessHistoryFilterInput, forcedUserId?: string) {
    const where = {
      ...(forcedUserId ? { userId: forcedUserId } : filters.usuarioId ? { userId: filters.usuarioId } : {}),
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
