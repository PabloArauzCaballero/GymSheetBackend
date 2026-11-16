/**
 * Strict parsing of "a file in this person's own storage folder".
 *
 * A prefix check on the raw URL (`url.startsWith(base + "/users/<me>/")`) let
 * `.../users/<me>/../<victim>/photo.jpg` through, and deleting that comment
 * would have released someone else's file. Here the URL is parsed, must share
 * the media base origin and path, and every key segment must be a plain name.
 */

/** A storage key made only of plain segments: no empty, `.`, `..` or percent-encoded parts. */
export function isSafeStorageKey(key: string): boolean {
  if (!key || key.startsWith("/") || key.includes("\\") || key.includes("%")) return false;
  return key.split("/").every((segment) => segment !== "" && segment !== "." && segment !== "..");
}

/**
 * The storage key of `url` when it points inside `users/<userId>/<folder>/`
 * under `publicBaseUrl`; otherwise null.
 */
export function ownMediaKey(
  url: string | null | undefined,
  userId: string,
  folder: string,
  publicBaseUrl: string,
): string | null {
  if (!url || !userId) return null;
  let parsed: URL;
  let base: URL;
  try {
    parsed = new URL(url);
    base = new URL(publicBaseUrl);
  } catch {
    return null;
  }
  if (parsed.origin !== base.origin || parsed.search || parsed.hash) return null;
  const basePath = base.pathname.replace(/\/+$/u, "");
  // The raw path, before the URL parser collapses `..`: compare what was sent.
  const rawPath = url.slice(parsed.origin.length).split(/[?#]/u)[0] ?? "";
  if (!rawPath.startsWith(`${basePath}/`)) return null;
  const key = rawPath.slice(basePath.length + 1);
  if (!isSafeStorageKey(key)) return null;
  const [root, owner, ownFolder, ...rest] = key.split("/");
  if (root !== "users" || owner !== userId || ownFolder !== folder || rest.length === 0) return null;
  return key;
}
