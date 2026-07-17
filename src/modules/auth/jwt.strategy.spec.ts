import { UnauthorizedException } from '@nestjs/common';
import { UserRole } from '../../common/enums/domain.enums';
import { JwtPayload } from '../../common/types/auth-context.types';
import { UsersRepository } from '../users/users.repository';
import { JwtStrategy } from './jwt.strategy';

const payload: JwtPayload = {
  sub: '00000000-0000-4000-8000-000000000001',
  email: 'owner@example.test',
  role: UserRole.CLIENT,
};

describe('JwtStrategy', () => {
  it('returns the current persisted role for an active principal', async () => {
    const usersRepository = {
      findActiveById: jest.fn().mockResolvedValue({
        id: payload.sub,
        email: payload.email,
        role: UserRole.ADMIN,
      }),
    } as unknown as UsersRepository;
    const strategy = new JwtStrategy(usersRepository);

    await expect(strategy.validate(payload)).resolves.toEqual({
      id: payload.sub,
      email: payload.email,
      role: UserRole.ADMIN,
    });
  });

  it('rejects a token when the user is missing or inactive', async () => {
    const usersRepository = {
      findActiveById: jest.fn().mockResolvedValue(null),
    } as unknown as UsersRepository;
    const strategy = new JwtStrategy(usersRepository);

    await expect(strategy.validate(payload)).rejects.toThrow(UnauthorizedException);
  });
});
