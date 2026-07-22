import { Logger } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { Sequelize } from 'sequelize-typescript';
import { UserRole, UserStatus } from '../../common/enums/domain.enums';
import { env } from '../../config/env';
import { UserModel } from '../../modules/users/user.model';
import { databaseModels } from '../models';

type SeedMode = 'base' | 'mock' | 'all';

interface SeedUser {
  email: string;
  fullName: string;
  password: string;
  role: UserRole;
  status: UserStatus;
}

const logger = new Logger('DatabaseSeeder');

function required(value: string | undefined, name: string): string {
  if (!value) throw new Error(`${name} is required for this seed mode.`);
  return value;
}

export function resolveSeedUsers(mode: SeedMode): SeedUser[] {
  const users: SeedUser[] = [];
  if (mode === 'base' || mode === 'all') {
    users.push({
      email: required(env.SEED_ADMIN_EMAIL, 'SEED_ADMIN_EMAIL').toLowerCase(),
      fullName: env.SEED_ADMIN_FULL_NAME,
      password: required(env.SEED_ADMIN_PASSWORD, 'SEED_ADMIN_PASSWORD'),
      role: UserRole.ADMIN,
      status: UserStatus.ACTIVE,
    });
  }
  if (mode === 'mock' || mode === 'all') {
    if (env.NODE_ENV === 'production') throw new Error('Mock seeds are forbidden in production.');
    const password = required(env.SEED_MOCK_PASSWORD, 'SEED_MOCK_PASSWORD');
    users.push(
      { email: 'coach.mock@gymsheet.local', fullName: 'Coach Mock', password, role: UserRole.COACH, status: UserStatus.ACTIVE },
      { email: 'athlete.mock@gymsheet.local', fullName: 'Athlete Mock', password, role: UserRole.CLIENT, status: UserStatus.ACTIVE },
      { email: 'inactive.mock@gymsheet.local', fullName: 'Inactive Mock', password, role: UserRole.CLIENT, status: UserStatus.INACTIVE },
    );
  }
  return users;
}

async function upsertUser(seedUser: SeedUser): Promise<'created' | 'updated' | 'unchanged'> {
  const existing = await UserModel.findOne({ where: { email: seedUser.email } });
  if (existing) {
    const passwordMatches = await bcrypt.compare(seedUser.password, existing.passwordHash);
    const unchanged =
      passwordMatches &&
      existing.fullName === seedUser.fullName &&
      existing.role === seedUser.role &&
      existing.status === seedUser.status;
    if (unchanged) return 'unchanged';
    const passwordHash = passwordMatches
      ? existing.passwordHash
      : await bcrypt.hash(seedUser.password, env.BCRYPT_SALT_ROUNDS);
    await existing.update({
      fullName: seedUser.fullName,
      passwordHash,
      role: seedUser.role,
      status: seedUser.status,
    });
    return 'updated';
  }
  const passwordHash = await bcrypt.hash(seedUser.password, env.BCRYPT_SALT_ROUNDS);
  const managedValues = {
    fullName: seedUser.fullName,
    passwordHash,
    role: seedUser.role,
    status: seedUser.status,
  };
  await UserModel.create({ email: seedUser.email, ...managedValues });
  return 'created';
}

async function run(): Promise<void> {
  const requestedMode = process.argv[2] ?? 'base';
  if (!['base', 'mock', 'all'].includes(requestedMode)) throw new Error('Seed mode must be base, mock, or all.');
  const mode = requestedMode as SeedMode;
  const users = resolveSeedUsers(mode);
  const sequelize = new Sequelize({
    dialect: 'postgres',
    host: env.DB_HOST,
    port: env.DB_PORT,
    database: env.DB_NAME,
    username: env.DB_USER,
    password: env.DB_PASSWORD,
    models: databaseModels,
    logging: false,
  });
  try {
    await sequelize.authenticate();
    const counters = { created: 0, updated: 0, unchanged: 0 };
    for (const user of users) counters[await upsertUser(user)] += 1;
    logger.log({ event: 'database.seed.completed', mode, ...counters });
  } finally {
    await sequelize.close();
  }
}

if (require.main === module) {
  void run().catch((error: unknown) => {
    logger.error({
      event: 'database.seed.failed',
      errorName: error instanceof Error ? error.name : 'UnknownError',
      errorMessage: error instanceof Error ? error.message : 'Unknown error',
    });
    process.exitCode = 1;
  });
}
