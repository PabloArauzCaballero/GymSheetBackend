import { env } from "../../../config/env";

/**
 * Runs `work` with `env.IP_HASH_SECRET` set to `secret` (undefined = unset)
 * and restores the original value afterwards. For unit tests only.
 */
export async function withIpHashSecret<T>(secret: string | undefined, work: () => Promise<T>): Promise<T> {
  const config = env as { IP_HASH_SECRET?: string };
  const had = Object.prototype.hasOwnProperty.call(config, "IP_HASH_SECRET");
  const previous = config.IP_HASH_SECRET;
  if (secret === undefined) delete config.IP_HASH_SECRET;
  else config.IP_HASH_SECRET = secret;
  try {
    return await work();
  } finally {
    if (had) config.IP_HASH_SECRET = previous;
    else delete config.IP_HASH_SECRET;
  }
}
