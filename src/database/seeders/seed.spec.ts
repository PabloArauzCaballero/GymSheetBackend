import { UserRole } from '../../common/enums/domain.enums';
import { resolveSeedUsers } from './seed';

describe('database seeds', () => {
  const emptyTestEnvironment = {
    NODE_ENV: 'test',
    SEED_ADMIN_EMAIL: undefined,
    SEED_ADMIN_PASSWORD: undefined,
    SEED_ADMIN_FULL_NAME: 'Test Admin',
    SEED_MOCK_PASSWORD: undefined,
    SEED_SYSTEM_CORPORATE_EMAIL: undefined,
    SEED_SYSTEM_CORPORATE_PASSWORD: undefined,
    SEED_SYSTEM_CORPORATE_FULL_NAME: 'GYM SHEET Corporativo',
  };

  it('requires runtime credentials for the production-safe base seed', () => {
    expect(() => resolveSeedUsers('base', emptyTestEnvironment)).toThrow(
      'SEED_ADMIN_EMAIL is required',
    );
  });

  it('requires an explicit development password for mock users', () => {
    expect(() => resolveSeedUsers('mock', emptyTestEnvironment)).toThrow(
      'SEED_MOCK_PASSWORD is required',
    );
  });

  it('forbids mock users in production', () => {
    expect(() =>
      resolveSeedUsers('mock', {
        ...emptyTestEnvironment,
        NODE_ENV: 'production',
        SEED_MOCK_PASSWORD: 'not-used-in-production',
      }),
    ).toThrow('Mock seeds are forbidden in production');
  });

  it('normalizes the configured base administrator email', () => {
    const [administrator] = resolveSeedUsers('base', {
      ...emptyTestEnvironment,
      SEED_ADMIN_EMAIL: 'ADMIN@EXAMPLE.COM',
      SEED_ADMIN_PASSWORD: 'safe-test-password',
    });

    expect(administrator.email).toBe('admin@example.com');
  });

  it('seeds the base administrator as the platform SYSTEM_ADMIN, never as gym staff (ADR-0019)', () => {
    const users = resolveSeedUsers('all', {
      ...emptyTestEnvironment,
      SEED_ADMIN_EMAIL: 'admin@example.com',
      SEED_ADMIN_PASSWORD: 'safe-test-password',
      SEED_MOCK_PASSWORD: 'safe-mock-password',
    });

    expect(users[0].role).toBe(UserRole.SYSTEM_ADMIN);
    const gymStaff = users.filter((user) => ['ADMIN', 'FRONT_DESK', 'COACH', 'ENTRENADOR_EXTERNO'].includes(user.role as string));
    expect(gymStaff).toEqual([]);
  });

  it('seeds scenario accounts with a verified email and leaves platform accounts as declared', () => {
    const users = resolveSeedUsers('all', {
      ...emptyTestEnvironment,
      SEED_ADMIN_EMAIL: 'admin@example.com',
      SEED_ADMIN_PASSWORD: 'safe-test-password',
      SEED_MOCK_PASSWORD: 'safe-mock-password',
    });

    const scenarios = users.filter((user) => user.email.endsWith('.mock@gymsheet.local'));
    expect(scenarios.length).toBeGreaterThan(0);
    expect(scenarios.every((user) => user.emailVerified === true)).toBe(true);
    expect(users.find((user) => user.email === 'admin@example.com')?.emailVerified).toBeUndefined();
  });
});
