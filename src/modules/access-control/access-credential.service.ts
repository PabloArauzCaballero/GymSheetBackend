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

  async createPin(input: CreatePinCredentialInput, tenantScope: string | null) {
    await this.requireActiveUserInScope(input.userId, tenantScope);
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

  async createExternalReference(
    input: CreateExternalCredentialInput,
    tenantScope: string | null,
  ) {
    await this.requireActiveUserInScope(input.userId, tenantScope);
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

  async revoke(id: string, input: RevokeCredentialInput, tenantScope: string | null) {
    const credential = await this.sequelize.transaction(async (transaction) => {
      const current = await this.repository.findById(id, transaction);
      if (!current) throw new NotFoundException('Credencial no encontrada.');
      // La credencial no guarda el gimnasio: se resuelve por su titular.
      await this.requireActiveUserInScope(current.userId, tenantScope);
      if (current.status === CredentialStatus.REVOKED) return current;
      return this.repository.revoke(
        current,
        input.motivo ?? null,
        transaction,
      );
    });
    return mapAccessCredential(credential);
  }

  async listByUser(userId: string, tenantScope: string | null) {
    await this.requireActiveUserInScope(userId, tenantScope);
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

  /**
   * Punto único por el que pasan todas las operaciones sobre credenciales.
   *
   * Comprueba existencia, actividad y **gimnasio**: una credencial de acceso
   * abre una puerta física, y hasta este cambio un administrador o recepción
   * de un gimnasio podía emitir, listar y revocar las de un socio de otro
   * (H-02). Fuera de alcance responde 404 y no 403: confirmar que la cuenta
   * existe ya sería decir de más.
   */
  private async requireActiveUserInScope(
    userId: string,
    tenantScope: string | null,
  ): Promise<void> {
    const user = await this.usersRepository.findById(userId);
    if (!user || user.status !== UserStatus.ACTIVE) {
      throw new UnprocessableEntityException(
        'El usuario no existe o está inactivo.',
      );
    }

    const userTenantId = user.tenantId ?? env.DEFAULT_TENANT_ID;
    if (tenantScope !== null && userTenantId !== tenantScope) {
      throw new NotFoundException('Usuario no encontrado.');
    }
  }
}
