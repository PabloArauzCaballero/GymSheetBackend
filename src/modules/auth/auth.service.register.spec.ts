import { JwtService } from '@nestjs/jwt';
import { Sequelize } from 'sequelize-typescript';
import { UserGender, UserRole } from '../../common/enums/domain.enums';
import { DomainException } from '../../common/errors/domain.exception';
import { LegalClientContext } from '../legal/legal-client-context';
import { LEGAL_DOCUMENTS } from '../legal/legal-documents';
import { LegalRepository } from '../legal/legal.repository';
import { LegalService } from '../legal/legal.service';
import { TenantsService } from '../tenants/tenants.service';
import { UsersRepository } from '../users/users.repository';
import { AuthService } from './auth.service';
import { RefreshTokenRepository } from './refresh-token.repository';

const context: LegalClientContext = { channel: 'ANDROID', ipHmac: null, userAgent: 'jest' };
const transaction = { id: 'signup-transaction' };
const input = {
  email: 'ana@example.test',
  password: 'clave-segura-1',
  fullName: 'Ana Prueba',
  gender: UserGender.FEMALE as UserGender.FEMALE,
  birthDate: '1995-05-15',
  termsVersion: LEGAL_DOCUMENTS.TERMS,
};

function build() {
  const createClient = jest.fn().mockResolvedValue({
    id: 'user-1',
    email: input.email,
    role: UserRole.CLIENT,
    fullName: input.fullName,
    tenantId: null,
  });
  const insertAcceptances = jest.fn().mockResolvedValue(undefined);
  const service = new AuthService(
    { findByEmail: jest.fn().mockResolvedValue(null), createClient } as unknown as UsersRepository,
    { assertActiveTenant: jest.fn() } as unknown as TenantsService,
    { create: jest.fn().mockResolvedValue(undefined) } as unknown as RefreshTokenRepository,
    { sign: jest.fn().mockReturnValue('access-token') } as unknown as JwtService,
    { transaction: jest.fn((work: (t: unknown) => unknown) => work(transaction)) } as unknown as Sequelize,
    new LegalService({ insertAcceptances } as unknown as LegalRepository),
  );
  return { service, createClient, insertAcceptances };
}

describe('AuthService.register legal acceptance', () => {
  it('rejects an outdated terms version before creating anything', async () => {
    const { service, createClient } = build();
    const outcome = service.register({ ...input, termsVersion: '2000-01-01' }, context);
    await expect(outcome).rejects.toBeInstanceOf(DomainException);
    await expect(outcome).rejects.toMatchObject({ code: 'TERMS_VERSION_OUTDATED' });
    expect(createClient).not.toHaveBeenCalled();
  });

  it('stores the birth date and sex on the account and records every document in the same transaction', async () => {
    const { service, createClient, insertAcceptances } = build();
    await service.register(input, context);
    expect(createClient).toHaveBeenCalledWith(
      expect.objectContaining({
        birthDate: '1995-05-15',
        gender: UserGender.FEMALE,
        termsVersion: LEGAL_DOCUMENTS.TERMS,
      }),
      transaction,
    );
    expect(insertAcceptances).toHaveBeenCalledWith(
      'user-1',
      [
        { document: 'TERMS', version: LEGAL_DOCUMENTS.TERMS },
        { document: 'PRIVACY', version: LEGAL_DOCUMENTS.PRIVACY },
      ],
      context,
      transaction,
    );
  });
});
