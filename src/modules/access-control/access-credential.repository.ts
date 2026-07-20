import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Transaction } from 'sequelize';
import { CredentialStatus, CredentialType } from '../../common/enums/domain.enums';
import { AccessCredentialModel } from './access-credential.model';
import { CreateExternalCredentialInput } from './access-credential.schemas';

@Injectable()
export class AccessCredentialRepository {
  constructor(
    @InjectModel(AccessCredentialModel)
    private readonly credentials: typeof AccessCredentialModel,
  ) {}

  findById(id: string, transaction?: Transaction) {
    return this.credentials.findByPk(id, {
      transaction,
      lock: transaction ? transaction.LOCK.UPDATE : undefined,
    });
  }

  findActivePin(userId: string, transaction?: Transaction) {
    return this.credentials.findOne({
      where: {
        userId,
        credentialType: CredentialType.PIN,
        status: CredentialStatus.ACTIVE,
      },
      transaction,
      lock: transaction ? transaction.LOCK.UPDATE : undefined,
    });
  }

  findActiveExternalReference(
    provider: string,
    credentialType: CredentialType,
    externalReference: string,
  ) {
    return this.credentials.findOne({
      where: {
        provider,
        credentialType,
        externalReference,
        status: CredentialStatus.ACTIVE,
      },
    });
  }

  listByUser(userId: string) {
    return this.credentials.findAll({
      where: { userId },
      order: [['enrolledAt', 'DESC']],
    });
  }

  createPin(
    userId: string,
    provider: string,
    pinHash: string,
    transaction: Transaction,
  ) {
    return this.credentials.create(
      {
        userId,
        provider,
        pinHash,
        externalReference: null,
        credentialType: CredentialType.PIN,
      },
      { transaction },
    );
  }

  createExternal(
    input: CreateExternalCredentialInput,
    transaction: Transaction,
  ) {
    return this.credentials.create({ ...input, pinHash: null }, { transaction });
  }

  async revoke(
    credential: AccessCredentialModel,
    reason: string | null,
    transaction: Transaction,
  ) {
    await credential.update(
      {
        status: CredentialStatus.REVOKED,
        revokedAt: new Date(),
        revocationReason: reason,
      },
      { transaction },
    );
    return credential;
  }

  async markVerified(credential: AccessCredentialModel) {
    await credential.update({ lastVerifiedAt: new Date() });
  }
}
