/**
 * Whole-word match of REPP's banned terms (`business.banned_terms`, ADR-0021)
 * against the normalized text bound as `:text`. One rule for business names
 * (KYC) and listings (ADR-0022): `repp_normalize` leaves only `[a-z0-9 ]`, so
 * neither side can carry a LIKE wildcard. The scope comes from this closed
 * type, never from input.
 */
export function bannedTermExistsSql(scope: 'NAME' | 'LISTING'): string {
  return `SELECT 1 FROM business.banned_terms t
           WHERE t.scope IN ('${scope}', 'BOTH')
             AND (' ' || public.repp_normalize(:text) || ' ') LIKE ('% ' || public.repp_normalize(t.term) || ' %')`;
}
