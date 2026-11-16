/**
 * SQL condition: the `public.usuarios` row aliased `alias` is a person, not a
 * business account (ADR-0020). Every listing of people — discovery, the gym
 * directory, the leaderboard — applies it, so a business never appears among
 * persons. The alias is code, never input.
 */
export function personAccountSql(alias: string): string {
  return `${alias}.rol <> 'NEGOCIO'`;
}
