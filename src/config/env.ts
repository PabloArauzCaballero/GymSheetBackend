import * as dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

/**
 * Parses explicit boolean environment values without JavaScript truthiness.
 * This prevents the string "false" from becoming true.
 */
export const environmentBooleanSchema = z.preprocess((rawValue) => {
  if (typeof rawValue === 'boolean') {
    return rawValue;
  }

  if (typeof rawValue !== 'string') {
    return rawValue;
  }

  const normalizedValue = rawValue.trim().toLowerCase();

  if (['true', '1', 'yes', 'on'].includes(normalizedValue)) {
    return true;
  }

  if (['false', '0', 'no', 'off'].includes(normalizedValue)) {
    return false;
  }

  return rawValue;
}, z.boolean());

const commaSeparatedListSchema = z.string().transform((rawValue) =>
  rawValue
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean),
);

export const environmentSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().max(65535).default(3000),
    API_PREFIX: z.string().trim().min(1).default('api/v1'),
    CORS_ORIGINS: commaSeparatedListSchema.default('http://localhost:5173'),
    TRUST_PROXY: environmentBooleanSchema.default(false),
    REQUEST_BODY_LIMIT: z.string().regex(/^\d+(kb|mb)$/i).default('1mb'),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

    DB_HOST: z.string().trim().min(1),
    DB_PORT: z.coerce.number().int().positive().max(65535).default(5432),
    DB_NAME: z.string().trim().min(1),
    DB_USER: z.string().trim().min(1),
    DB_PASSWORD: z.string().min(1),
    DB_SSL: environmentBooleanSchema.default(false),
    DB_SSL_REJECT_UNAUTHORIZED: environmentBooleanSchema.default(true),
    DB_LOGGING: environmentBooleanSchema.default(false),
    DB_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),
    DB_POOL_MIN: z.coerce.number().int().min(0).max(20).default(0),
    DB_POOL_ACQUIRE_MS: z.coerce.number().int().min(1000).max(120000).default(30000),
    DB_POOL_IDLE_MS: z.coerce.number().int().min(1000).max(120000).default(10000),
    DB_CONNECT_TIMEOUT_MS: z.coerce.number().int().min(1000).max(60000).default(10000),
    DB_STATEMENT_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120000).default(15000),

    JWT_ACCESS_SECRET: z.string().min(64),
    JWT_ACCESS_EXPIRES_IN: z.string().trim().min(2).default('15m'),
    JWT_REFRESH_SECRET: z.string().min(64),
    JWT_REFRESH_EXPIRES_IN: z.string().trim().min(2).default('7d'),
    JWT_ISSUER: z.string().trim().min(3).default('gym-sheet-api'),
    JWT_AUDIENCE: z.string().trim().min(3).default('gym-sheet-web'),

    BCRYPT_SALT_ROUNDS: z.coerce.number().int().min(10).max(14).default(12),
    RATE_LIMIT_TTL_SECONDS: z.coerce.number().int().positive().max(3600).default(60),
    RATE_LIMIT_MAX: z.coerce.number().int().positive().max(10000).default(100),
    AUTH_RATE_LIMIT_MAX: z.coerce.number().int().positive().max(100).default(10),
    GATEWAY_ENABLED: environmentBooleanSchema.default(true),

    EXERCISES_DATASET_ENABLED: environmentBooleanSchema.default(false),
    EXERCISES_DATASET_JSON_URL: z
      .string()
      .url()
      .default('https://raw.githubusercontent.com/hasaneyldrm/exercises-dataset/main/dist/exercises.json'),
    EXERCISES_DATASET_ALLOWED_HOSTS: commaSeparatedListSchema.default('raw.githubusercontent.com,github.com'),
    EXERCISES_DATASET_TIMEOUT_MS: z.coerce.number().int().min(1000).max(60000).default(15000),
    EXERCISES_DATASET_MAX_RESPONSE_BYTES: z.coerce.number().int().min(1024).max(52428800).default(15728640),
    EXERCISES_DATASET_BATCH_SIZE: z.coerce.number().int().min(1).max(500).default(100),
    EXERCISES_DATASET_IMPORT_MEDIA: environmentBooleanSchema.default(false),
    EXERCISES_DATASET_MEDIA_LICENSE_CONFIRMED: environmentBooleanSchema.default(false),
  })
  .superRefine((configuration, context) => {
    if (configuration.DB_POOL_MIN > configuration.DB_POOL_MAX) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['DB_POOL_MIN'],
        message: 'DB_POOL_MIN cannot be greater than DB_POOL_MAX.',
      });
    }

    if (configuration.JWT_ACCESS_SECRET === configuration.JWT_REFRESH_SECRET) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['JWT_REFRESH_SECRET'],
        message: 'Access and refresh secrets must be different.',
      });
    }

    if (configuration.EXERCISES_DATASET_IMPORT_MEDIA && !configuration.EXERCISES_DATASET_MEDIA_LICENSE_CONFIRMED) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['EXERCISES_DATASET_MEDIA_LICENSE_CONFIRMED'],
        message: 'Media import requires explicit confirmation of the applicable media license.',
      });
    }
  });

const parsedEnvironment = environmentSchema.safeParse(process.env);

if (!parsedEnvironment.success) {
  throw new Error(`Invalid environment variables: ${JSON.stringify(parsedEnvironment.error.flatten().fieldErrors)}`);
}

export const env = parsedEnvironment.data;
