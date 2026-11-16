import { z } from "zod";

/**
 * Environment of user-content deletion on MinIO (ADR-0017).
 *
 * Kept apart from `env.ts` so the rule reads as one unit; the main schema only
 * spreads it. It must not import `env.ts`: that file imports this one.
 */
const emptyAsUndefined = (value: unknown) => (value === "" ? undefined : value);

export const mediaEnvironmentShape = {
  /**
   * Declares that the MinIO user of the API may delete every version under
   * `users/*` (policy in ADR-0017). Only `true` or `false`: it is a statement
   * about the server, so no `1`/`yes` spellings. Unset means `true`; in
   * production with `MEDIA_STORAGE_PROVIDER=minio` it must be explicit.
   * Ignored by the local adapter, which always deletes.
   */
  MEDIA_USER_CONTENT_DELETABLE: z.preprocess(
    emptyAsUndefined,
    z
      .enum(["true", "false"])
      .transform((value) => value === "true")
      .optional(),
  ),
};

type MediaEnvironment = {
  NODE_ENV: string;
  MEDIA_STORAGE_PROVIDER: string;
  MEDIA_USER_CONTENT_DELETABLE?: boolean;
};

export function refineMediaEnvironment(configuration: MediaEnvironment, context: z.RefinementCtx): void {
  if (
    configuration.NODE_ENV === "production" &&
    configuration.MEDIA_STORAGE_PROVIDER === "minio" &&
    configuration.MEDIA_USER_CONTENT_DELETABLE === undefined
  )
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["MEDIA_USER_CONTENT_DELETABLE"],
      message:
        "MEDIA_USER_CONTENT_DELETABLE (true|false) is required in production with MinIO: set true only after applying the ADR-0017 delete policy to the API user.",
    });
}
