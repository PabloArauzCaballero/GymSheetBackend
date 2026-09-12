import * as dotenv from "dotenv";
import { z } from "zod";

// dotenv v17 prints an unstructured banner to stdout on load, which corrupts
// the structured JSON log stream this service emits. Values are never logged.
dotenv.config({ quiet: true });

type JwtDurationUnit = "ms" | "s" | "m" | "h" | "d" | "w" | "y";
export type JwtDuration = `${number}${JwtDurationUnit}`;

export const environmentBooleanSchema = z.preprocess((rawValue) => {
  if (typeof rawValue === "boolean") return rawValue;
  if (typeof rawValue !== "string") return rawValue;
  const normalizedValue = rawValue.trim().toLowerCase();
  if (["true", "1", "yes", "on"].includes(normalizedValue)) return true;
  if (["false", "0", "no", "off"].includes(normalizedValue)) return false;
  return rawValue;
}, z.boolean());

const commaSeparatedListSchema = z.string().transform((rawValue) =>
  rawValue
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean),
);
const jwtDurationSchema = z
  .string()
  .trim()
  .regex(/^\d+(?:ms|s|m|h|d|w|y)$/)
  .transform((duration) => duration as JwtDuration);
const optionalUrlSchema = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.string().url().optional(),
);
const optionalSecretSchema = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.string().min(32).optional(),
);
// Deployment platforms (Coolify, Docker, k8s) commonly materialize an unset
// optional variable as an empty string rather than omitting it entirely; a
// bare `.optional()` still runs its validators against "" and rejects it.
const optionalNonEmptyStringSchema = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.string().trim().min(1).optional(),
);
const optionalEmailSchema = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.string().trim().email().optional(),
);

export const environmentSchema = z
  .object({
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),
    PORT: z.coerce.number().int().positive().max(65535).default(3000),
    API_PREFIX: z.string().trim().min(1).default("api/v1"),
    CORS_ORIGINS: commaSeparatedListSchema.default("http://localhost:5173"),
    TRUST_PROXY: environmentBooleanSchema.default(false),
    REQUEST_BODY_LIMIT: z
      .string()
      .regex(/^\d+(kb|mb)$/i)
      .default("1mb"),
    LOG_LEVEL: z
      .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
      .default("info"),
    BUSINESS_TIME_ZONE: z
      .string()
      .trim()
      .min(3)
      .max(80)
      .default("America/La_Paz"),
    /**
     * Gimnasio al que se adscriben las cuentas nuevas cuando el cliente no
     * declara uno, y bajo el que se agrupan las cuentas sin `tenant_id` propio
     * al resolver aislamiento entre gimnasios (directorio, conexiones, chat).
     *
     * Instalación multi-tenant: siempre resuelve a un valor (por defecto
     * `"default"`), así ninguna cuenta sin tenant explícito queda "sin filtro"
     * y visible a cualquier otro gimnasio — ese fue el hueco de seguridad que
     * esto cierra. Cambiarlo solo tiene sentido si además se migran los
     * `tenant_id` existentes; no lo uses como toggle de "una sola marca".
     */
    DEFAULT_TENANT_ID: z.preprocess(
      (value) => (value === "" ? undefined : value),
      z
        .string()
        .trim()
        .toLowerCase()
        .regex(/^[a-z0-9][a-z0-9-]*$/)
        .max(60)
        .default("default"),
    ),
    ACCESS_POLICY_VERSION: z
      .string()
      .trim()
      .min(1)
      .max(80)
      .default("2026-07-19"),
    ACCESS_MOCK_ENABLED: environmentBooleanSchema.default(false),
    WHATSAPP_MEMBERSHIP_PHONE: z
      .string()
      .trim()
      .regex(/^\d{8,15}$/),
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
    DB_POOL_ACQUIRE_MS: z.coerce
      .number()
      .int()
      .min(1000)
      .max(120000)
      .default(30000),
    DB_POOL_IDLE_MS: z.coerce
      .number()
      .int()
      .min(1000)
      .max(120000)
      .default(10000),
    DB_CONNECT_TIMEOUT_MS: z.coerce
      .number()
      .int()
      .min(1000)
      .max(60000)
      .default(10000),
    DB_STATEMENT_TIMEOUT_MS: z.coerce
      .number()
      .int()
      .min(1000)
      .max(120000)
      .default(15000),

    JWT_ACCESS_SECRET: z.string().min(64),
    JWT_ACCESS_EXPIRES_IN: jwtDurationSchema.default("15m"),
    /**
     * Vida del token de suplantación (`POST /auth/impersonate-tenant`). Corta a
     * propósito: una suplantación es un estado excepcional y no debe
     * convertirse en un modo pegajoso que alguien olvide que tiene puesto. El
     * refresh tampoco la hereda.
     */
    JWT_IMPERSONATION_EXPIRES_IN: jwtDurationSchema.default("15m"),
    JWT_REFRESH_SECRET: z.string().min(64),
    JWT_REFRESH_EXPIRES_IN: jwtDurationSchema.default("7d"),
    JWT_ISSUER: z.string().trim().min(3).default("gym-sheet-api"),
    JWT_AUDIENCE: z.string().trim().min(3).default("gym-sheet-web"),

    BCRYPT_SALT_ROUNDS: z.coerce.number().int().min(10).max(14).default(12),
    RATE_LIMIT_TTL_SECONDS: z.coerce
      .number()
      .int()
      .positive()
      .max(3600)
      .default(60),
    RATE_LIMIT_MAX: z.coerce.number().int().positive().max(10000).default(100),
    AUTH_RATE_LIMIT_MAX: z.coerce
      .number()
      .int()
      .positive()
      .max(100)
      .default(10),
    /**
     * Tráfico anónimo (directorio público de gimnasios): el límite general
     * está pensado para cuentas ya autenticadas, y una landing pensada para
     * indexarse necesita un techo más alto que el de login/registro.
     */
    PUBLIC_RATE_LIMIT_MAX: z.coerce
      .number()
      .int()
      .positive()
      .max(1000)
      .default(60),
    GATEWAY_ENABLED: environmentBooleanSchema.default(true),
    /**
     * Optional Redis connection for shared rate-limit counters. When unset the
     * throttler keeps per-process in-memory counters, which means the effective
     * limit multiplies by the number of instances. Required in any horizontally
     * scaled deployment; see REDIS_REQUIRED to fail fast instead of degrading.
     */
    REDIS_URL: z.preprocess(
      (value) => (value === "" ? undefined : value),
      z
        .string()
        .url()
        .refine(
          (value) =>
            value.startsWith("redis://") || value.startsWith("rediss://"),
          "REDIS_URL must use the redis:// or rediss:// scheme.",
        )
        .optional(),
    ),
    /**
     * When true, startup fails if REDIS_URL is absent. Prevents a multi-instance
     * deployment from silently falling back to per-process rate limiting.
     */
    REDIS_REQUIRED: environmentBooleanSchema.default(false),
    REDIS_CONNECT_TIMEOUT_MS: z.coerce
      .number()
      .int()
      .min(500)
      .max(30000)
      .default(5000),

    WORKER_POLL_INTERVAL_MS: z.coerce
      .number()
      .int()
      .min(100)
      .max(60000)
      .default(1000),
    WORKER_BATCH_SIZE: z.coerce.number().int().min(1).max(500).default(50),
    WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(50).default(5),
    WORKER_LOCK_TIMEOUT_MS: z.coerce
      .number()
      .int()
      .min(5000)
      .max(3600000)
      .default(300000),
    WORKER_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(20).default(5),
    /**
     * Retention window for the outbox prune command (`db:outbox:prune`). Only
     * COMPLETED jobs whose `processed_at` is older than this are eligible for
     * deletion; every other state is left untouched. The command is opt-in and
     * dry-runs unless invoked with `--apply`.
     */
    OUTBOX_RETENTION_DAYS: z.coerce.number().int().min(1).max(3650).default(30),
    OUTBOX_PRUNE_BATCH_SIZE: z.coerce
      .number()
      .int()
      .min(1)
      .max(100000)
      .default(1000),
    REMINDER_SCAN_INTERVAL_MS: z.coerce
      .number()
      .int()
      .min(60000)
      .max(86400000)
      .default(3600000),
    /**
     * Purga de stories caducadas (`worker:stories-purge`). Cada pasada borra
     * como mucho `STORIES_PURGE_BATCH_SIZE` filas y, si el lote sale lleno,
     * encadena otro sin esperar; el intervalo solo separa las pasadas ociosas.
     */
    STORIES_PURGE_INTERVAL_MS: z.coerce
      .number()
      .int()
      .min(60000)
      .max(86400000)
      .default(3600000),
    STORIES_PURGE_BATCH_SIZE: z.coerce
      .number()
      .int()
      .min(1)
      .max(5000)
      .default(200),
    NOTIFICATION_DELIVERY_PROVIDER: z
      .enum(["IN_APP", "HTTP_GATEWAY", "MOCK"])
      .default("IN_APP"),
    NOTIFICATION_GATEWAY_URL: optionalUrlSchema,
    NOTIFICATION_GATEWAY_SECRET: optionalSecretSchema,
    NOTIFICATION_GATEWAY_ALLOWED_HOSTS: commaSeparatedListSchema.default(""),
    NOTIFICATION_GATEWAY_TIMEOUT_MS: z.coerce
      .number()
      .int()
      .min(1000)
      .max(60000)
      .default(10000),

    /**
     * Cómo salen los correos. `LOG` los escribe en el registro con el cuerpo
     * completo —imprescindible para recorrer el flujo de recuperación en local
     * sin un buzón—, y por eso mismo está prohibido en producción: un PIN en
     * los registros es una credencial en los registros.
     */
    MAIL_TRANSPORT: z.enum(["LOG", "SMTP", "GMAIL"]).default("LOG"),
    MAIL_FROM: optionalEmailSchema,
    MAIL_SMTP_HOST: optionalNonEmptyStringSchema,
    MAIL_SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(587),
    MAIL_SMTP_USER: optionalNonEmptyStringSchema,
    MAIL_SMTP_PASSWORD: optionalNonEmptyStringSchema,
    MAIL_SMTP_TIMEOUT_MS: z.coerce
      .number()
      .int()
      .min(1000)
      .max(60000)
      .default(10000),

    /**
     * Gmail por OAuth2. Se usa el refresh token en vez de una contraseña de
     * aplicación porque Google la revoca en cuanto la cuenta cambia de
     * política, y porque un token acotado a enviar correo no da acceso al
     * buzón.
     */
    GMAIL_CLIENT_ID: optionalNonEmptyStringSchema,
    GMAIL_CLIENT_SECRET: optionalNonEmptyStringSchema,
    GMAIL_REFRESH_TOKEN: optionalNonEmptyStringSchema,
    GMAIL_FROM_EMAIL: optionalEmailSchema,

    /**
     * Dónde vive el portal web, para componer enlaces que se envían fuera de la
     * aplicación. Un enlace de activación viaja por WhatsApp y tiene que abrir
     * el portal del gimnasio, no la API.
     */
    PORTAL_PUBLIC_URL: z.string().trim().url().default("http://localhost:3000"),

    /** Vida del enlace de activación por pago en efectivo. */
    ACTIVATION_LINK_TTL_HOURS: z.coerce.number().int().min(1).max(168).default(48),

    /**
     * Vida del PIN de recuperación. Corta a propósito: es el único intervalo en
     * el que una credencial de seis cifras vale para entrar en una cuenta.
     */
    PASSWORD_RESET_PIN_TTL_MINUTES: z.coerce
      .number()
      .int()
      .min(1)
      .max(60)
      .default(10),
    /** Intentos fallidos antes de quemar el PIN. Seis cifras se prueban solas. */
    PASSWORD_RESET_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(20).default(5),

    EXERCISES_DATASET_ENABLED: environmentBooleanSchema.default(false),
    EXERCISES_DATASET_JSON_URL: z
      .string()
      .url()
      .default(
        "https://raw.githubusercontent.com/hasaneyldrm/exercises-dataset/main/data/exercises.json",
      ),
    EXERCISES_DATASET_ALLOWED_HOSTS: commaSeparatedListSchema.default(
      "raw.githubusercontent.com",
    ),
    EXERCISES_DATASET_TIMEOUT_MS: z.coerce
      .number()
      .int()
      .min(1000)
      .max(60000)
      .default(15000),
    EXERCISES_DATASET_MAX_RESPONSE_BYTES: z.coerce
      .number()
      .int()
      .min(1024)
      .max(52428800)
      .default(25000000),
    EXERCISES_DATASET_BATCH_SIZE: z.coerce
      .number()
      .int()
      .min(1)
      .max(500)
      .default(100),
    EXERCISES_DATASET_MIN_RECORDS: z.coerce
      .number()
      .int()
      .min(1)
      .max(5000)
      .default(1000),
    EXERCISES_DATASET_REFRESH_INTERVAL_MS: z.coerce
      .number()
      .int()
      .min(3600000)
      .max(604800000)
      .default(86400000),
    EXERCISES_DATASET_REFRESH_RETRY_MS: z.coerce
      .number()
      .int()
      .min(60000)
      .max(86400000)
      .default(3600000),
    EXERCISES_DATASET_IMPORT_MEDIA: environmentBooleanSchema.default(false),
    EXERCISES_DATASET_MEDIA_LICENSE_CONFIRMED:
      environmentBooleanSchema.default(false),
    EXERCISES_OPEN_MEDIA_ENABLED: environmentBooleanSchema.default(true),
    EXERCISES_OPEN_MEDIA_JSON_URL: z
      .string()
      .url()
      .default(
        "https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/dist/exercises.json",
      ),
    EXERCISES_OPEN_MEDIA_BASE_URL: z
      .string()
      .url()
      .default(
        "https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/exercises/",
      ),
    /**
     * Fuente canónica del catálogo de ejercicios en el arranque (ADR-0006, opción b):
     * `seeders` aplica un snapshot local si existe; `github` delega en el worker del
     * dataset. Sin fallback silencioso: `github` exige EXERCISES_DATASET_ENABLED=true.
     */
    CANONICAL_EXERCISES_SOURCE: z
      .enum(["seeders", "github"])
      .default("seeders"),
    SEED_ADMIN_EMAIL: z.preprocess(
      (value) => (value === "" ? undefined : value),
      z.string().email().optional(),
    ),
    SEED_ADMIN_PASSWORD: z.preprocess(
      (value) => (value === "" ? undefined : value),
      z.string().min(12).max(128).optional(),
    ),
    /**
     * Cuenta de plataforma (`SYSTEM_ADMIN`) para la consola de sistema.
     *
     * Opcional a propósito y sin valor por defecto: es un credencial
     * supra-gimnasio, y una instalación que no lo pida explícitamente no debe
     * acabar con una cuenta capaz de operar sobre todos los gimnasios porque
     * un seeder la creó sola.
     */
    SEED_SYSTEM_ADMIN_EMAIL: z.preprocess(
      (value) => (value === "" ? undefined : value),
      z.string().email().optional(),
    ),
    SEED_SYSTEM_ADMIN_PASSWORD: z.preprocess(
      (value) => (value === "" ? undefined : value),
      z.string().min(12).max(128).optional(),
    ),
    SEED_SYSTEM_ADMIN_FULL_NAME: z
      .string()
      .trim()
      .min(2)
      .max(180)
      .default("GymSheet Platform Administrator"),
    SEED_ADMIN_FULL_NAME: z
      .string()
      .trim()
      .min(2)
      .max(180)
      .default("GymSheet Administrator"),
    SEED_MOCK_PASSWORD: z.preprocess(
      (value) => (value === "" ? undefined : value),
      z.string().min(12).max(128).optional(),
    ),
    /**
     * Cuenta de sistema global usada como chat fijo "GYM SHEET Corporativo"
     * en la lista de conversaciones de cada usuario. Opcional a propósito:
     * sin ella, ese chat simplemente no se crea (no hay fallback silencioso
     * a una cuenta que nadie sembró).
     */
    SEED_SYSTEM_CORPORATE_EMAIL: z.preprocess(
      (value) => (value === "" ? undefined : value),
      z.string().email().optional(),
    ),
    SEED_SYSTEM_CORPORATE_PASSWORD: z.preprocess(
      (value) => (value === "" ? undefined : value),
      z.string().min(12).max(128).optional(),
    ),
    SEED_SYSTEM_CORPORATE_FULL_NAME: z
      .string()
      .trim()
      .min(2)
      .max(180)
      .default("GYM SHEET Corporativo"),

    /**
     * Almacenamiento de media (arquitectura de puertos y adaptadores). `local`
     * persiste en disco vía el adaptador Multer; `cloudinary`/`s3` requieren su
     * adaptador implementado (hoy detienen el arranque, sin fallback silencioso).
     */
    MEDIA_STORAGE_PROVIDER: z
      .enum(["local", "cloudinary", "s3"])
      .default("local"),
    MEDIA_STORAGE_LOCAL_ROOT: z.string().trim().min(1).default("storage/media"),
    MEDIA_STORAGE_PUBLIC_BASE_URL: z
      .string()
      .url()
      .default("http://localhost:3000/media"),
    MEDIA_UPLOAD_MAX_BYTES: z.coerce
      .number()
      .int()
      .min(1024)
      .max(52428800)
      .default(5242880),
    MEDIA_ALLOWED_MIME: commaSeparatedListSchema.default(
      "image/jpeg,image/png,image/webp,image/gif",
    ),
    /**
     * Adjuntos de chat (fotos/video, incluida la vista única): límite propio
     * porque un video pesa mucho más que una foto de perfil, y un tipo MIME
     * propio porque acá sí se admite video, a diferencia de `MEDIA_ALLOWED_MIME`.
     */
    CHAT_MEDIA_MAX_BYTES: z.coerce
      .number()
      .int()
      .min(1024)
      .max(104857600)
      .default(26214400),
    CHAT_MEDIA_ALLOWED_MIME: commaSeparatedListSchema.default(
      "image/jpeg,image/png,image/webp,image/gif,video/mp4,video/quicktime",
    ),
    /** Allowlist SSRF de orígenes desde los que `db:media:mirror` puede descargar. */
    MEDIA_MIRROR_ALLOWED_HOSTS: commaSeparatedListSchema.default(
      "images.unsplash.com,raw.githubusercontent.com",
    ),
    MEDIA_MIRROR_TIMEOUT_MS: z.coerce
      .number()
      .int()
      .min(1000)
      .max(60000)
      .default(15000),
    /** Credenciales opcionales para un futuro CloudinaryAdapter (no versionar valores). */
    CLOUDINARY_CLOUD_NAME: z.preprocess(
      (value) => (value === "" ? undefined : value),
      z.string().trim().min(1).optional(),
    ),
    CLOUDINARY_API_KEY: z.preprocess(
      (value) => (value === "" ? undefined : value),
      z.string().trim().min(1).optional(),
    ),
    CLOUDINARY_API_SECRET: optionalSecretSchema,
    CLOUDINARY_FOLDER: z.preprocess(
      (value) => (value === "" ? undefined : value),
      z.string().trim().min(1).optional(),
    ),
  })
  .superRefine((configuration, context) => {
    if (configuration.DB_POOL_MIN > configuration.DB_POOL_MAX)
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["DB_POOL_MIN"],
        message: "DB_POOL_MIN cannot be greater than DB_POOL_MAX.",
      });
    if (configuration.JWT_ACCESS_SECRET === configuration.JWT_REFRESH_SECRET)
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["JWT_REFRESH_SECRET"],
        message: "Access and refresh secrets must be different.",
      });
    if (
      configuration.NODE_ENV === "production" &&
      configuration.ACCESS_MOCK_ENABLED
    )
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["ACCESS_MOCK_ENABLED"],
        message: "Access mock endpoints are forbidden in production.",
      });
    if (
      configuration.NODE_ENV === "production" &&
      configuration.NOTIFICATION_DELIVERY_PROVIDER === "MOCK"
    )
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["NOTIFICATION_DELIVERY_PROVIDER"],
        message: "MOCK notification delivery is forbidden in production.",
      });
    if (
      configuration.NODE_ENV === "production" &&
      configuration.MAIL_TRANSPORT === "LOG"
    )
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["MAIL_TRANSPORT"],
        message:
          "The LOG mail transport prints message bodies, including reset PINs. It is forbidden in production.",
      });
    if (configuration.MAIL_TRANSPORT === "GMAIL") {
      if (
        !configuration.GMAIL_CLIENT_ID ||
        !configuration.GMAIL_CLIENT_SECRET ||
        !configuration.GMAIL_REFRESH_TOKEN ||
        !configuration.GMAIL_FROM_EMAIL
      )
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["GMAIL_CLIENT_ID"],
          message:
            "Gmail delivery requires client id, client secret, refresh token and sender address.",
        });
    }
    if (configuration.MAIL_TRANSPORT === "SMTP") {
      if (!configuration.MAIL_SMTP_HOST || !configuration.MAIL_FROM)
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["MAIL_SMTP_HOST"],
          message: "SMTP mail delivery requires a host and a sender address.",
        });
    }
    if (configuration.NOTIFICATION_DELIVERY_PROVIDER === "HTTP_GATEWAY") {
      if (
        !configuration.NOTIFICATION_GATEWAY_URL ||
        !configuration.NOTIFICATION_GATEWAY_SECRET
      )
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["NOTIFICATION_GATEWAY_URL"],
          message: "HTTP gateway delivery requires URL and secret.",
        });
      if (configuration.NOTIFICATION_GATEWAY_URL) {
        const url = new URL(configuration.NOTIFICATION_GATEWAY_URL);
        if (
          url.protocol !== "https:" ||
          !configuration.NOTIFICATION_GATEWAY_ALLOWED_HOSTS.includes(
            url.hostname,
          )
        )
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["NOTIFICATION_GATEWAY_URL"],
            message:
              "Notification gateway must use HTTPS and an allowlisted host.",
          });
      }
    }
    if (
      configuration.EXERCISES_DATASET_IMPORT_MEDIA &&
      !configuration.EXERCISES_DATASET_MEDIA_LICENSE_CONFIRMED
    )
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["EXERCISES_DATASET_MEDIA_LICENSE_CONFIRMED"],
        message:
          "Media import requires explicit confirmation of the applicable media license.",
      });
    if (configuration.REDIS_REQUIRED && !configuration.REDIS_URL)
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["REDIS_URL"],
        message: "REDIS_URL is required when REDIS_REQUIRED is enabled.",
      });
    if (
      configuration.CANONICAL_EXERCISES_SOURCE === "github" &&
      !configuration.EXERCISES_DATASET_ENABLED
    )
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["EXERCISES_DATASET_ENABLED"],
        message:
          "CANONICAL_EXERCISES_SOURCE=github requires EXERCISES_DATASET_ENABLED=true (no silent fallback).",
      });
    try {
      new Intl.DateTimeFormat("en-CA", {
        timeZone: configuration.BUSINESS_TIME_ZONE,
      }).format();
    } catch {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["BUSINESS_TIME_ZONE"],
        message: "BUSINESS_TIME_ZONE must be a valid IANA time zone.",
      });
    }
  });

const parsedEnvironment = environmentSchema.safeParse(process.env);
if (!parsedEnvironment.success)
  throw new Error(
    `Invalid environment variables: ${JSON.stringify(parsedEnvironment.error.flatten().fieldErrors)}`,
  );
export const env = parsedEnvironment.data;
