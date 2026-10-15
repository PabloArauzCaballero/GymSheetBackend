/** Stable, privacy-minimal tags derived only from a member's declared goal and intent. */
export function recommendationFeatureCodes(
  goal: string | null | undefined,
  intents: readonly string[] | null | undefined,
): string[] {
  const normalize = (value: string) =>
    value
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/gu, "")
      .toUpperCase()
      .replace(/[^A-Z0-9_.:-]/gu, "_");
  return [
    ...new Set(
      [
        ...(intents ?? []).map((intent) => `intent:${normalize(intent)}`),
        ...(goal ? [`goal:${normalize(goal)}`] : []),
      ].filter((code) => /^[A-Za-z0-9_.:-]{1,80}$/u.test(code)),
    ),
  ].slice(0, 50);
}
