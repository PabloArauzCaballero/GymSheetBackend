import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { UniqueConstraintError } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import {
  CredentialStatus,
  CredentialType,
  UserStatus,
} from '../../common/enums/domain.enums';
import { env } from '../../config/env';
import { UsersRepository } from '../users/users.repository';
import { mapAccessCredential } from './access-credential.mapper';
import { AccessCredentialRepository } from './access-credential.repository';
import {
  CreateExternalCredentialInput,
  CreatePinCredentialInput,
  RevokeCredentialInput,
} from './access-credential.schemas';

@Injectable()
export class AccessCredentialService {
  constructor(
    private readonly repository: AccessCredentialRepository,
    private readonly usersRepository: UsersRepository,
    private readonly sequelize: Sequelize,
  ) {}

  async createPin(input: CreatePinCredentialInput) {
    await this.requireActiveUser(input.userId);
    const pinHash = await bcrypt.hash(input.pin, env.BCRYPT_SALT_ROUNDS);
    const credential = await this.sequelize.transaction(async (transaction) => {
      const current = await this.repository.findActivePin(
        input.userId,
        transaction,
      );
      if (current) {
        await this.repository.revoke(current, 'PIN reemplazado', transaction);
      }
      return this.repository.createPin(
        input.userId,
        input.provider,
        pinHash,
        transaction,
      );
    });
    return mapAccessCredential(credential);
  }

  async createExternalReference(input: CreateExternalCredentialInput) {
    await this.requireActiveUser(input.userId);
    try {
      const credential = await this.sequelize.transaction((transaction) =>
        this.repository.createExternal(input, transaction),
      );
      return mapAccessCredential(credential);
    } catch (error: unknown) {
      if (error instanceof UniqueConstraintError) {
        throw new ConflictException('La referencia externa ya está registrada.');
      }
      throw error;
    }
  }

  async revoke(id: string, input: RevokeCredentialInput) {
    const credential = await this.sequelize.transaction(async (transaction) => {
      const current = await this.repository.findById(id, transaction);
      if (!current) throw new NotFoundException('Credencial no encontrada.');
      if (current.status === CredentialStatus.REVOKED) return current;
      return this.repository.revoke(
        current,
        input.motivo ?? null,
        transaction,
      );
    });
    return mapAccessCredential(credential);
  }

  async listByUser(userId: string) {
    return (await this.repository.listByUser(userId)).map(mapAccessCredential);
  }

  async verifyPin(userId: string, pin: string) {
    const credential = await this.repository.findActivePin(userId);
    if (!credential?.pinHash) return null;
    if (!(await bcrypt.compare(pin, credential.pinHash))) return null;
    await this.repository.markVerified(credential);
    return credential;
  }

  async resolveExternalReference(
    provider: string,
    credentialType: CredentialType,
    externalReference: string,
  ) {
    const credential = await this.repository.findActiveExternalReference(
      provider,
      credentialType,
      externalReference,
    );
    if (credential) await this.repository.markVerified(credential);
    return credential;
  }

  private async requireActiveUser(userId: string): Promise<void> {
    const user = await this.usersRepository.findById(userId);
    if (!user || user.status !== UserStatus.ACTIVE) {
      throw new UnprocessableEntityException(
        'El usuario no existe o está inactivo.',
      );
    }
  }
}
