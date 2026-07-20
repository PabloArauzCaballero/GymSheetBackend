import * as dotenv from 'dotenv';
import { z } from 'zod';

// dotenv v17 prints an unstructured banner to stdout on load, which corrupts
// the structured JSON log stream this service emits. Values are never logged.
dotenv.config({ quiet: true });

type JwtDurationUnit = 'ms' | 's' | 'm' | 'h' | 'd' | 'w' | 'y';
export type JwtDuration = `${number}${JwtDurationUnit}`;

export const environmentBooleanSchema = z.preprocess((rawValue) => {
  if (typeof rawValue === 'boolean') return rawValue;
  if (typeof rawValue !== 'string') return rawValue;
  const normalizedValue = rawValue.trim().toLowerCase();
  if (['true', '1', 'yes', 'on'].includes(normalizedValue)) return true;
  if (['false', '0', 'no', 'off'].includes(normalizedValue)) return false;
  return rawValue;
}, z.boolean());

const commaSeparatedListSchema = z.string().transform((rawValue) =>
  rawValue.split(',').map((entry) => entry.trim()).filter(Boolean),
);
const jwtDurationSchema = z.string().trim().regex(/^\d+(?:ms|s|m|h|d|w|y)$/).transform((duration) => duration as JwtDuration);
const optionalUrlSchema = z.preprocess(
  (value) => (value === '' ? undefined : value),
  z.string().url().optional(),
);
const optionalSecretSchema = z.preprocess(
  (value) => (value === '' ? undefined : value),
  z.string().min(32).optional(),
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
    BUSINESS_TIME_ZONE: z.string().trim().min(3).max(80).default('America/La_Paz'),
    ACCESS_POLICY_VERSION: z.string().trim().min(1).max(80).default('2026-07-19'),
    ACCESS_MOCK_ENABLED: environmentBooleanSchema.default(false),
    /**
     * Optional bearer token required by GET /health/metrics. When unset the
     * endpoint stays open, preserving existing scrape configurations; the
     * recommended deployment sets it or restricts the route at network level.
     */
    METRICS_SCRAPE_TOKEN: optionalSecretSchema,

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
    JWT_ACCESS_EXPIRES_IN: jwtDurationSchema.default('15m'),
    JWT_REFRESH_SECRET: z.string().min(64),
    JWT_REFRESH_EXPIRES_IN: jwtDurationSchema.default('7d'),
    JWT_ISSUER: z.string().trim().min(3).default('gym-sheet-api'),
    JWT_AUDIENCE: z.string().trim().min(3).default('gym-sheet-web'),

    BCRYPT_SALT_ROUNDS: z.coerce.number().int().min(10).max(14).default(12),
    RATE_LIMIT_TTL_SECONDS: z.coerce.number().int().positive().max(3600).default(60),
    RATE_LIMIT_MAX: z.coerce.number().int().positive().max(10000).default(100),
    AUTH_RATE_LIMIT_MAX: z.coerce.number().int().positive().max(100).default(10),
    GATEWAY_ENABLED: environmentBooleanSchema.default(true),
    /**
     * Optional Redis connection for shared rate-limit counters. When unset the
     * throttler keeps per-process in-memory counters, which means the effective
     * limit multiplies by the number of instances. Required in any horizontally
     * scaled deployment; see REDIS_REQUIRED to fail fast instead of degrading.
     */
    REDIS_URL: z.preprocess(
      (value) => (value === '' ? undefined : value),
      z
        .string()
        .url()
        .refine(
          (value) => value.startsWith('redis://') || value.startsWith('rediss://'),
          'REDIS_URL must use the redis:// or rediss:// scheme.',
        )
        .optional(),
    ),
    /**
     * When true, startup fails if REDIS_URL is absent. Prevents a multi-instance
     * deployment from silently falling back to per-process rate limiting.
     */
    REDIS_REQUIRED: environmentBooleanSchema.default(false),
    REDIS_CONNECT_TIMEOUT_MS: z.coerce.number().int().min(500).max(30000).default(5000),

    WORKER_POLL_INTERVAL_MS: z.coerce.number().int().min(100).max(60000).default(1000),
    WORKER_BATCH_SIZE: z.coerce.number().int().min(1).max(500).default(50),
    WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(50).default(5),
    WORKER_LOCK_TIMEOUT_MS: z.coerce.number().int().min(5000).max(3600000).default(300000),
    WORKER_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(20).default(5),
    REMINDER_SCAN_INTERVAL_MS: z.coerce.number().int().min(60000).max(86400000).default(3600000),
    NOTIFICATION_DELIVERY_PROVIDER: z.enum(['IN_APP', 'HTTP_GATEWAY', 'MOCK']).default('IN_APP'),
    NOTIFICATION_GATEWAY_URL: optionalUrlSchema,
    NOTIFICATION_GATEWAY_SECRET: optionalSecretSchema,
    NOTIFICATION_GATEWAY_ALLOWED_HOSTS: commaSeparatedListSchema.default(''),
    NOTIFICATION_GATEWAY_TIMEOUT_MS: z.coerce.number().int().min(1000).max(60000).default(10000),

    EXERCISES_DATASET_ENABLED: environmentBooleanSchema.default(false),
    EXERCISES_DATASET_JSON_URL: z.string().url().default('https://raw.githubusercontent.com/hasaneyldrm/exercises-dataset/main/data/exercises.json'),
    EXERCISES_DATASET_ALLOWED_HOSTS: commaSeparatedListSchema.default('raw.githubusercontent.com'),
    EXERCISES_DATASET_TIMEOUT_MS: z.coerce.number().int().min(1000).max(60000).default(15000),
    EXERCISES_DATASET_MAX_RESPONSE_BYTES: z.coerce.number().int().min(1024).max(52428800).default(15728640),
    EXERCISES_DATASET_BATCH_SIZE: z.coerce.number().int().min(1).max(500).default(100),
    EXERCISES_DATASET_IMPORT_MEDIA: environmentBooleanSchema.default(false),
    EXERCISES_DATASET_MEDIA_LICENSE_CONFIRMED: environmentBooleanSchema.default(false),
  })
  .superRefine((configuration, context) => {
    if (configuration.DB_POOL_MIN > configuration.DB_POOL_MAX) context.addIssue({ code: z.ZodIssueCode.custom, path: ['DB_POOL_MIN'], message: 'DB_POOL_MIN cannot be greater than DB_POOL_MAX.' });
    if (configuration.JWT_ACCESS_SECRET === configuration.JWT_REFRESH_SECRET) context.addIssue({ code: z.ZodIssueCode.custom, path: ['JWT_REFRESH_SECRET'], message: 'Access and refresh secrets must be different.' });
    if (configuration.NODE_ENV === 'production' && configuration.ACCESS_MOCK_ENABLED) context.addIssue({ code: z.ZodIssueCode.custom, path: ['ACCESS_MOCK_ENABLED'], message: 'Access mock endpoints are forbidden in production.' });
    if (configuration.NODE_ENV === 'production' && configuration.NOTIFICATION_DELIVERY_PROVIDER === 'MOCK') context.addIssue({ code: z.ZodIssueCode.custom, path: ['NOTIFICATION_DELIVERY_PROVIDER'], message: 'MOCK notification delivery is forbidden in production.' });
    if (configuration.NOTIFICATION_DELIVERY_PROVIDER === 'HTTP_GATEWAY') {
      if (!configuration.NOTIFICATION_GATEWAY_URL || !configuration.NOTIFICATION_GATEWAY_SECRET) context.addIssue({ code: z.ZodIssueCode.custom, path: ['NOTIFICATION_GATEWAY_URL'], message: 'HTTP gateway delivery requires URL and secret.' });
      if (configuration.NOTIFICATION_GATEWAY_URL) {
        const url = new URL(configuration.NOTIFICATION_GATEWAY_URL);
        if (url.protocol !== 'https:' || !configuration.NOTIFICATION_GATEWAY_ALLOWED_HOSTS.includes(url.hostname)) context.addIssue({ code: z.ZodIssueCode.custom, path: ['NOTIFICATION_GATEWAY_URL'], message: 'Notification gateway must use HTTPS and an allowlisted host.' });
      }
    }
    if (configuration.EXERCISES_DATASET_IMPORT_MEDIA && !configuration.EXERCISES_DATASET_MEDIA_LICENSE_CONFIRMED) context.addIssue({ code: z.ZodIssueCode.custom, path: ['EXERCISES_DATASET_MEDIA_LICENSE_CONFIRMED'], message: 'Media import requires explicit confirmation of the applicable media license.' });
    if (configuration.REDIS_REQUIRED && !configuration.REDIS_URL) context.addIssue({ code: z.ZodIssueCode.custom, path: ['REDIS_URL'], message: 'REDIS_URL is required when REDIS_REQUIRED is enabled.' });
    try { new Intl.DateTimeFormat('en-CA', { timeZone: configuration.BUSINESS_TIME_ZONE }).format(); } catch { context.addIssue({ code: z.ZodIssueCode.custom, path: ['BUSINESS_TIME_ZONE'], message: 'BUSINESS_TIME_ZONE must be a valid IANA time zone.' }); }
  });

const parsedEnvironment = environmentSchema.safeParse(process.env);
if (!parsedEnvironment.success) throw new Error(`Invalid environment variables: ${JSON.stringify(parsedEnvironment.error.flatten().fieldErrors)}`);
export const env = parsedEnvironment.data;
