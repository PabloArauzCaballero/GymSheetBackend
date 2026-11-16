import { CONSENT_VERSIONS, ConsentKind, PERSON_CONSENT_KINDS } from "../legal/consent-versions";
import type { ConsentRow } from "./consents.repository";

export type ConsentResponse = {
  kind: ConsentKind;
  granted: boolean;
  /** Version of the text the person agreed to; null if never granted. */
  version: string | null;
  currentVersion: string;
  /** False when granted to an older text: the client should ask again. */
  upToDate: boolean;
  grantedAt: string | null;
  revokedAt: string | null;
};

export function mapConsent(kind: ConsentKind, row: ConsentRow | undefined): ConsentResponse {
  const currentVersion = CONSENT_VERSIONS[kind];
  const granted = Boolean(row && row.revokedAt === null);
  return {
    kind,
    granted,
    version: row?.version ?? null,
    currentVersion,
    upToDate: granted && row?.version === currentVersion,
    grantedAt: row ? new Date(row.grantedAt).toISOString() : null,
    revokedAt: row?.revokedAt ? new Date(row.revokedAt).toISOString() : null,
  };
}

export function mapConsents(rows: readonly ConsentRow[], kinds: readonly ConsentKind[] = PERSON_CONSENT_KINDS): ConsentResponse[] {
  const byKind = new Map(rows.map((row) => [row.kind, row]));
  return kinds.map((kind) => mapConsent(kind, byKind.get(kind)));
}
