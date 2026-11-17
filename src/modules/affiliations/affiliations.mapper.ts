import { resolveMediaUrl } from '../../common/media/media-url';
import { AffiliationKind, AffiliationStatus } from './affiliation.catalog';
import { GymViewRow, OwnViewRow } from './affiliation-views.repository';

const iso = (value: Date | null): string | null => (value ? new Date(value).toISOString() : null);

/** What the person (or the coach business) reads of their own affiliation. */
export type OwnAffiliationDto = {
  id: string;
  kind: AffiliationKind;
  status: AffiliationStatus;
  gym: { id: string; name: string; handle: string | null; logoUrl: string | null };
  location: { id: string; name: string } | null;
  /** Persons only: the digits they typed (null for a coach, or after the account closure). */
  ciLast3: string | null;
  /** A «cambio de gimnasio»: the confirmed SOCIO this request ends when the new gym confirms. */
  replacesAffiliationId: string | null;
  reasonCode: string | null;
  reasonNote: string | null;
  requestedAt: string;
  confirmedAt: string | null;
  closedAt: string | null;
};

export function mapOwnAffiliation(row: OwnViewRow, subject: 'PERSON' | 'COACH'): OwnAffiliationDto {
  return {
    id: row.id,
    kind: row.kind,
    status: row.status,
    gym: { id: row.gymId, name: row.gymName, handle: row.gymHandle, logoUrl: resolveMediaUrl(row.gymLogoUrl) },
    location: row.locationId && row.locationName ? { id: row.locationId, name: row.locationName } : null,
    ciLast3: subject === 'PERSON' ? row.ciLast3 : null,
    replacesAffiliationId: row.replacesAffiliationId,
    reasonCode: row.reasonCode,
    reasonNote: row.reasonNote,
    requestedAt: new Date(row.requestedAt).toISOString(),
    confirmedAt: iso(row.confirmedAt),
    closedAt: iso(row.closedAt),
  };
}

export type GymPersonSubjectDto = { type: 'PERSON'; displayName: string; photoUrl: string | null; ciLast3: string | null };
export type GymBusinessSubjectDto = { type: 'BUSINESS'; name: string; handle: string | null; logoUrl: string | null; badge: 'VERIFIED' | 'NEW' };

/**
 * What the gym reads (owner decision 16/11/2026). The keys are a contract
 * pinned by the e2e: adding one is a product decision, not a refactor.
 */
export type GymAffiliationDto = {
  id: string;
  kind: AffiliationKind;
  status: AffiliationStatus;
  /** Null once the row is closed: the gym keeps the fact and the dates, never who it was. */
  subject: GymPersonSubjectDto | GymBusinessSubjectDto | null;
  location: { id: string; name: string } | null;
  requestedAt: string;
  confirmedAt: string | null;
};

export function mapGymAffiliation(row: GymViewRow): GymAffiliationDto {
  const subject: GymAffiliationDto['subject'] = !row.live
    ? null
    : row.subjectType === 'PERSON'
      ? { type: 'PERSON', displayName: row.personName ?? '', photoUrl: resolveMediaUrl(row.personPhotoUrl), ciLast3: row.ciLast3 }
      : { type: 'BUSINESS', name: row.coachName ?? '', handle: row.coachHandle, logoUrl: resolveMediaUrl(row.coachLogoUrl), badge: row.coachVerified ? 'VERIFIED' : 'NEW' };
  return {
    id: row.id,
    kind: row.kind,
    status: row.status,
    subject,
    location: row.locationId && row.locationName ? { id: row.locationId, name: row.locationName } : null,
    requestedAt: new Date(row.requestedAt).toISOString(),
    confirmedAt: iso(row.confirmedAt),
  };
}
