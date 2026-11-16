/**
 * Strict parsing of "a file in this person's own storage folder".
 *
 * A prefix check on the raw URL (`url.startsWith(base + "/users/<me>/")`) let
 * `.../users/<me>/../<victim>/photo.jpg` through, and deleting that comment
 * would have released someone else's file. Here the URL is parsed, must share
 * the media base origin and path, and every key segment must be a plain name.
 */

/** Whitespace or control characters: parsers strip or normalize them differently. */
const UNSAFE_CHARACTERS = {
  test(value: string): boolean {
    for (const character of value) {
      const code = character.codePointAt(0) ?? 0;
      if (code <= 0x1f || code === 0x7f || /\s/u.test(character)) return true;
    }
    return false;
  },
};

/** A storage key made only of plain segments: no empty, `.`, `..`, percent-encoded or control-character parts. */
export function isSafeStorageKey(key: string): boolean {
  if (!key || key.startsWith("/") || key.includes("\\") || key.includes("%") || UNSAFE_CHARACTERS.test(key)) {
    return false;
  }
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
  // Rejected before parsing: the URL parser drops tabs/newlines and trims spaces,
  // so the string it validates would not be the string that was stored.
  if (!url || !userId || UNSAFE_CHARACTERS.test(url)) return null;
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
  // Nothing the parser normalized may slip through: the parsed path must be the raw one.
  if (parsed.pathname !== rawPath || !rawPath.startsWith(`${basePath}/`)) return null;
  const key = rawPath.slice(basePath.length + 1);
  if (!isSafeStorageKey(key)) return null;
  const [root, owner, ownFolder, ...rest] = key.split("/");
  if (root !== "users" || owner !== userId || ownFolder !== folder || rest.length === 0) return null;
  return key;
}
