/**
 * Layer 2: a hidden form field people never see and bots fill in. Whitespace
 * counts as empty so an autofill quirk cannot reject a person.
 */
export function honeypotTripped(honeypot: string | null): boolean {
  return honeypot !== null && honeypot.trim().length > 0;
}
