/**
 * Rules of the public `@handle` namespace (ADR-0020, plan §2.2). Pure
 * functions: the repository and the service apply them under a lock.
 */

export const HANDLE_MIN_LENGTH = 3;
export const HANDLE_MAX_LENGTH = 30;

/** A PENDING reservation of a listing that never went public expires after this. */
export const PENDING_HANDLE_TTL_DAYS = 14;
/** A retired handle redirects to the new one for this long… */
export const RETIRED_REDIRECT_DAYS = 90;
/** …and nobody else can take it (or a look-alike) for this long. */
export const RETIRED_LOCK_DAYS = 180;
export const RENAME_LIMITS = { perWindow: 1, windowDays: 30, perYear: 3 } as const;

const FORMAT = /^[a-z0-9]+(?:[._][a-z0-9]+)*$/u;
const ONLY_DIGITS = /^[0-9._]+$/u;

/**
 * Words nobody may take as a handle, compared by skeleton so `adm1n` is
 * `admin`. REPP protects brands with `RESERVED` rows in `directory.handles`.
 */
export const RESERVED_HANDLE_WORDS: readonly string[] = [
  'repp', 'admin', 'administrador', 'root', 'sistema', 'system', 'staff', 'soporte', 'support', 'ayuda',
  'help', 'api', 'www', 'app', 'moderacion', 'moderador', 'oficial', 'official', 'gym', 'gimnasio',
  'marketplace', 'negocio', 'negocios', 'login', 'registro', 'signup', 'legal', 'terminos',
  'privacidad', 'seguridad', 'security', 'pagos', 'pago', 'cuenta', 'perfil', 'directorio',
  'public', 'publico', 'settings', 'ajustes', 'coach', 'tienda',
];

/** The platform's own name may not appear anywhere in a handle. */
const PROTECTED_SUBSTRINGS: readonly string[] = ['repp'];

/** Look-alike characters folded together so `t0p.fitness` and `top_fitness` collide. */
const CONFUSABLES: Readonly<Record<string, string>> = { '0': 'o', '1': 'l', i: 'l', '5': 's', '3': 'e' };

export type HandleRejection = 'INVALID' | 'RESERVED';

/**
 * Canonical form of what a person typed: trimmed, without the leading `@`,
 * NFKC, lower case. Null when the result is not plain ASCII.
 */
export function normalizeHandle(input: string): string | null {
  const normalized = input.trim().replace(/^@/u, '').normalize('NFKC').toLowerCase();
  // eslint-disable-next-line no-control-regex -- the range is the point: ASCII only.
  return /^[\x00-\x7f]*$/u.test(normalized) ? normalized : null;
}

/** Anti-impersonation key: separators dropped, confusables folded. */
export function handleSkeleton(handle: string): string {
  return [...handle.replace(/[._]/gu, '')].map((character) => CONFUSABLES[character] ?? character).join('');
}

const RESERVED_SKELETONS = new Set(RESERVED_HANDLE_WORDS.map(handleSkeleton));

/** Null when `handle` (already normalized) is a valid, non-reserved handle. */
export function rejectHandle(handle: string): HandleRejection | null {
  if (handle.length < HANDLE_MIN_LENGTH || handle.length > HANDLE_MAX_LENGTH) return 'INVALID';
  if (!FORMAT.test(handle) || ONLY_DIGITS.test(handle)) return 'INVALID';
  const skeleton = handleSkeleton(handle);
  if (RESERVED_SKELETONS.has(skeleton)) return 'RESERVED';
  if (PROTECTED_SUBSTRINGS.some((word) => skeleton.includes(handleSkeleton(word)))) return 'RESERVED';
  return null;
}

/** Normalizes and validates in one step, for the edges that receive raw input. */
export function parseHandle(input: string): { handle: string; skeleton: string } | { rejection: HandleRejection } {
  const handle = normalizeHandle(input);
  if (handle === null) return { rejection: 'INVALID' };
  const rejection = rejectHandle(handle);
  return rejection ? { rejection } : { handle, skeleton: handleSkeleton(handle) };
}

const DAY_MS = 86_400_000;

export function addDays(from: Date, days: number): Date {
  return new Date(from.getTime() + days * DAY_MS);
}

/**
 * Whether a public rename is allowed now, given the times of the previous
 * public renames (`directory.handle_changes`, reason USER): at most one every
 * 30 days and three per year.
 */
export function renameAllowed(previousRenames: readonly Date[], now: Date): boolean {
  const inWindow = previousRenames.filter((at) => at > addDays(now, -RENAME_LIMITS.windowDays)).length;
  const inYear = previousRenames.filter((at) => at > addDays(now, -365)).length;
  return inWindow < RENAME_LIMITS.perWindow && inYear < RENAME_LIMITS.perYear;
}
