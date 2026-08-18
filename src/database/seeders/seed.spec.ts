import { resolveSeedUsers } from './seed';

describe('database seeds', () => {
  const emptyTestEnvironment = {
    NODE_ENV: 'test',
    SEED_ADMIN_EMAIL: undefined,
    SEED_ADMIN_PASSWORD: undefined,
    SEED_ADMIN_FULL_NAME: 'Test Admin',
    SEED_MOCK_PASSWORD: undefined,
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
});
