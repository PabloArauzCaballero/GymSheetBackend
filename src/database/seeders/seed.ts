import { Logger } from "@nestjs/common";
import * as bcrypt from "bcryptjs";
import { Transaction } from "sequelize";
import { Sequelize } from "sequelize-typescript";
import { UserRole, UserStatus } from "../../common/enums/domain.enums";
import { env } from "../../config/env";
import { UserModel } from "../../modules/users/user.model";
import { seedEquipmentCatalog } from "./equipment-catalog.seed";
import { seedExerciseEquipment } from "./exercise-equipment.seed";
import { databaseModels } from "../models";
import { seedCustomerExperience } from "./customer-experience.seed";

export type SeedMode = "base" | "mock" | "all";

interface SeedUser {
  email: string;
  fullName: string;
  password: string;
  role: UserRole;
  status: UserStatus;
}

interface SeedEnvironment {
  NODE_ENV: string;
  SEED_ADMIN_EMAIL?: string;
  SEED_ADMIN_PASSWORD?: string;
  SEED_ADMIN_FULL_NAME: string;
  SEED_MOCK_PASSWORD?: string;
}

const logger = new Logger("DatabaseSeeder");
const seedLockName = "gym_sheet_backend_database_seeds";

function required(value: string | undefined, name: string): string {
  if (!value) throw new Error(`${name} is required for this seed mode.`);
  return value;
}

export function resolveSeedUsers(
  mode: SeedMode,
  seedEnvironment: SeedEnvironment = env,
): SeedUser[] {
  const users: SeedUser[] = [];
  if (mode === "base" || mode === "all") {
    users.push({
      email: required(
        seedEnvironment.SEED_ADMIN_EMAIL,
        "SEED_ADMIN_EMAIL",
      ).toLowerCase(),
      fullName: seedEnvironment.SEED_ADMIN_FULL_NAME,
      password: required(
        seedEnvironment.SEED_ADMIN_PASSWORD,
        "SEED_ADMIN_PASSWORD",
      ),
      role: UserRole.ADMIN,
      status: UserStatus.ACTIVE,
    });
  }
  if (mode === "mock" || mode === "all") {
    if (seedEnvironment.NODE_ENV === "production")
      throw new Error("Mock seeds are forbidden in production.");
    const password = required(
      seedEnvironment.SEED_MOCK_PASSWORD,
      "SEED_MOCK_PASSWORD",
    );
    users.push(
      {
        email: "coach.mock@gymsheet.local",
        fullName: "Coach Mock",
        password,
        role: UserRole.COACH,
        status: UserStatus.ACTIVE,
      },
      {
        email: "athlete.mock@gymsheet.local",
        fullName: "Athlete Mock",
        password,
        role: UserRole.CLIENT,
        status: UserStatus.ACTIVE,
      },
      {
        email: "inactive.mock@gymsheet.local",
        fullName: "Inactive Mock",
        password,
        role: UserRole.CLIENT,
        status: UserStatus.INACTIVE,
      },
      ...[
        ["new.mock@gymsheet.local", "New User Mock"],
        ["onboarding.mock@gymsheet.local", "Incomplete Onboarding Mock"],
        ["active.mock@gymsheet.local", "Active Membership Mock"],
        ["expiring.mock@gymsheet.local", "Expiring Membership Mock"],
        ["expired.mock@gymsheet.local", "Expired Membership Mock"],
        ["pending.mock@gymsheet.local", "Pending Renewal Mock"],
      ].map(([email, fullName]) => ({
        email,
        fullName,
        password,
        role: UserRole.CLIENT,
        status: UserStatus.ACTIVE,
      })),
    );
  }
  return users;
}

async function upsertUser(
  seedUser: SeedUser,
  transaction: Transaction,
): Promise<"created" | "updated" | "unchanged"> {
  const existing = await UserModel.findOne({
    where: { email: seedUser.email },
    transaction,
  });
  if (existing) {
    const passwordMatches = await bcrypt.compare(
      seedUser.password,
      existing.passwordHash,
    );
    const unchanged =
      passwordMatches &&
      existing.fullName === seedUser.fullName &&
      existing.role === seedUser.role &&
      existing.status === seedUser.status;
    if (unchanged) return "unchanged";
    const passwordHash = passwordMatches
      ? existing.passwordHash
      : await bcrypt.hash(seedUser.password, env.BCRYPT_SALT_ROUNDS);
    await existing.update(
      {
        fullName: seedUser.fullName,
        passwordHash,
        role: seedUser.role,
        status: seedUser.status,
      },
      { transaction },
    );
    return "updated";
  }
  const passwordHash = await bcrypt.hash(
    seedUser.password,
    env.BCRYPT_SALT_ROUNDS,
  );
  const managedValues = {
    fullName: seedUser.fullName,
    passwordHash,
    role: seedUser.role,
    status: seedUser.status,
  };
  await UserModel.create(
    { email: seedUser.email, ...managedValues },
    { transaction },
  );
  return "created";
}

export async function runSeeds(mode: SeedMode): Promise<void> {
  const users = resolveSeedUsers(mode);
  const sequelize = new Sequelize({
    dialect: "postgres",
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
    await sequelize.transaction(async (transaction) => {
      await sequelize.query(
        "SELECT pg_advisory_xact_lock(hashtext(:lockName))",
        {
          replacements: { lockName: seedLockName },
          transaction,
        },
      );
      for (const user of users) {
        counters[await upsertUser(user, transaction)] += 1;
      }
      // El catálogo de equipamiento va en la siembra base porque no es
      // contenido de demostración: es el punto de partida de cualquier
      // instalación real, y sin él el panel de equipamiento abre vacío.
      if (mode === "base" || mode === "all") {
        await seedEquipmentCatalog(sequelize, transaction);
        // Después del catálogo y no antes: enlazar ejercicios con máquinas
        // exige que las máquinas ya existan. Es lo que permite que el gimnasio
        // vea qué equipamiento se usa sin pedirle nada a quien entrena.
        await seedExerciseEquipment(sequelize, transaction);
      }
      await seedCustomerExperience(mode, transaction);
    });
    logger.log({ event: "database.seed.completed", mode, ...counters });
  } finally {
    await sequelize.close();
  }
}

if (require.main === module) {
  const requestedMode = process.argv[2] ?? "base";
  if (!["base", "mock", "all"].includes(requestedMode)) {
    throw new Error("Seed mode must be base, mock, or all.");
  }
  void runSeeds(requestedMode as SeedMode).catch((error: unknown) => {
    logger.error({
      event: "database.seed.failed",
      errorName: error instanceof Error ? error.name : "UnknownError",
      errorMessage: error instanceof Error ? error.message : "Unknown error",
    });
    process.exitCode = 1;
  });
}
