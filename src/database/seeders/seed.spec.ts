import { resolveSeedUsers } from './seed';

describe('database seeds', () => {
  it('requires runtime credentials for the production-safe base seed', () => {
    expect(() => resolveSeedUsers('base')).toThrow('SEED_ADMIN_EMAIL is required');
  });

  it('requires an explicit development password for mock users', () => {
    expect(() => resolveSeedUsers('mock')).toThrow('SEED_MOCK_PASSWORD is required');
  });
});
