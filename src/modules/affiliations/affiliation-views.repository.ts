import { Injectable } from '@nestjs/common';
import { QueryTypes } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import { AffiliationKind, AffiliationStatus } from './affiliation.catalog';
import { Subject } from './affiliations.repository';

const KEY = (column: string) => `to_char(${column} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

/** A row as its subject (the person or the coach) reads it: the gym, never the gym's other affiliates. */
export type OwnViewRow = {
  id: string;
  kind: AffiliationKind;
  status: AffiliationStatus;
  ciLast3: string | null;
  reasonCode: string | null;
  reasonNote: string | null;
  replacesAffiliationId: string | null;
  requestedAt: Date;
  confirmedAt: Date | null;
  closedAt: Date | null;
  gymId: string;
  gymName: string;
  gymHandle: string | null;
  gymLogoUrl: string | null;
  locationId: string | null;
  locationName: string | null;
  cursorKey: string;
};

/**
 * A row as the gym reads it. Exactly what the owner allowed (16/11/2026): for
 * a person the display name, the main photo, the declared location, the dates
 * and the three CI digits; for a coach business its public card. No user id,
 * email, birth date, social profile or full CI is ever selected.
 */
export type GymViewRow = {
  id: string;
  kind: AffiliationKind;
  status: AffiliationStatus;
  requestedAt: Date;
  confirmedAt: Date | null;
  subjectType: 'PERSON' | 'BUSINESS';
  personName: string | null;
  personPhotoUrl: string | null;
  ciLast3: string | null;
  coachName: string | null;
  coachHandle: string | null;
  coachLogoUrl: string | null;
  coachVerified: boolean | null;
  locationId: string | null;
  locationName: string | null;
  cursorKey: string;
};

type Page = { after: { key: string; id: string } | null; limit: number };

const OWN_SELECT = `
  SELECT a.id, a.kind, a.status, a.ci_last3 AS "ciLast3", a.reason_code AS "reasonCode", a.reason_note AS "reasonNote",
         a.replaces_affiliation_id AS "replacesAffiliationId", a.requested_at AS "requestedAt",
         a.confirmed_at AS "confirmedAt", a.closed_at AS "closedAt",
         g.id AS "gymId", g.name AS "gymName", gh.handle AS "gymHandle", g.logo_url AS "gymLogoUrl",
         l.id AS "locationId", l.name AS "locationName", ${KEY('a.requested_at')} AS "cursorKey"
    FROM directory.affiliations a
    JOIN directory.entities g ON g.id = a.gym_entity_id
    LEFT JOIN directory.handles gh ON gh.owner_entity_id = g.id AND gh.status = 'ACTIVE'
    LEFT JOIN directory.entity_locations l ON l.id = a.location_id`;

const GYM_SELECT = (sortColumn: string) => `
  SELECT a.id, a.kind, a.status, a.requested_at AS "requestedAt", a.confirmed_at AS "confirmedAt",
         CASE WHEN a.user_id IS NOT NULL THEN 'PERSON' ELSE 'BUSINESS' END AS "subjectType",
         u.nombre_completo AS "personName", ph.url AS "personPhotoUrl", a.ci_last3 AS "ciLast3",
         c.name AS "coachName", ch.handle AS "coachHandle", c.logo_url AS "coachLogoUrl", c.is_verified AS "coachVerified",
         l.id AS "locationId", l.name AS "locationName", ${KEY(sortColumn)} AS "cursorKey"
    FROM directory.affiliations a
    LEFT JOIN public.usuarios u ON u.id = a.user_id
    LEFT JOIN LATERAL (SELECT p.url FROM profile.photos p WHERE p.user_id = a.user_id AND p.hidden_at IS NULL
                        ORDER BY p.position ASC LIMIT 1) ph ON true
    LEFT JOIN directory.entities c ON c.id = a.coach_entity_id
    LEFT JOIN directory.handles ch ON ch.owner_entity_id = c.id AND ch.status = 'ACTIVE'
    LEFT JOIN directory.entity_locations l ON l.id = a.location_id`;

/** Reads of affiliations, each scoped to one subject or one gym: anyone else's row is never found. */
@Injectable()
export class AffiliationViewsRepository {
  constructor(private readonly sequelize: Sequelize) {}

  /** The subject's own rows, newest first (`ix_affiliations_person` / `ix_affiliations_coach`). */
  listOwn(subject: Subject, page: Page): Promise<OwnViewRow[]> {
    return this.sequelize.query<OwnViewRow>(
      `${OWN_SELECT} WHERE ${ownWhere(subject)}
         ${page.after ? 'AND (a.requested_at, a.id) < (CAST(:afterAt AS timestamptz), CAST(:afterId AS uuid))' : ''}
       ORDER BY a.requested_at DESC, a.id DESC LIMIT :limit`,
      { type: QueryTypes.SELECT, replacements: { ...ownReplacements(subject), ...pageReplacements(page) } },
    );
  }

  async findOwn(subject: Subject, affiliationId: string): Promise<OwnViewRow | null> {
    const [row] = await this.sequelize.query<OwnViewRow>(`${OWN_SELECT} WHERE ${ownWhere(subject)} AND a.id = :affiliationId`, {
      type: QueryTypes.SELECT,
      replacements: { ...ownReplacements(subject), affiliationId },
    });
    return row ?? null;
  }

  /** Pending requests of a gym, oldest first (`ix_affiliations_gym_requested`). */
  listRequests(gymEntityId: string, filter: { kind?: AffiliationKind; locationId?: string }, page: Page): Promise<GymViewRow[]> {
    const where = ['a.gym_entity_id = :gymEntityId', "a.status = 'REQUESTED'"];
    if (filter.kind) where.push('a.kind = :kind');
    if (filter.locationId) where.push('a.location_id = :locationId');
    if (page.after) where.push('(a.requested_at, a.id) > (CAST(:afterAt AS timestamptz), CAST(:afterId AS uuid))');
    return this.sequelize.query<GymViewRow>(
      `${GYM_SELECT('a.requested_at')} WHERE ${where.join(' AND ')} ORDER BY a.requested_at ASC, a.id ASC LIMIT :limit`,
      { type: QueryTypes.SELECT, replacements: { gymEntityId, kind: filter.kind ?? null, locationId: filter.locationId ?? null, ...pageReplacements(page) } },
    );
  }

  /** Confirmed members (SOCIO) or coaches (ENTRENADOR) of a gym, newest first (`ix_affiliations_gym_confirmed`). */
  listConfirmed(gymEntityId: string, kind: AffiliationKind, filter: { locationId?: string }, page: Page): Promise<GymViewRow[]> {
    const where = ['a.gym_entity_id = :gymEntityId', 'a.kind = :kind', "a.status = 'CONFIRMED'"];
    if (filter.locationId) where.push('a.location_id = :locationId');
    if (page.after) where.push('(a.confirmed_at, a.id) < (CAST(:afterAt AS timestamptz), CAST(:afterId AS uuid))');
    return this.sequelize.query<GymViewRow>(
      `${GYM_SELECT('a.confirmed_at')} WHERE ${where.join(' AND ')} ORDER BY a.confirmed_at DESC, a.id DESC LIMIT :limit`,
      { type: QueryTypes.SELECT, replacements: { gymEntityId, kind, locationId: filter.locationId ?? null, ...pageReplacements(page) } },
    );
  }

  async findForGym(gymEntityId: string, affiliationId: string): Promise<GymViewRow | null> {
    const [row] = await this.sequelize.query<GymViewRow>(
      `${GYM_SELECT('a.requested_at')} WHERE a.gym_entity_id = :gymEntityId AND a.id = :affiliationId`,
      { type: QueryTypes.SELECT, replacements: { gymEntityId, affiliationId } },
    );
    return row ?? null;
  }

  /** «Por confirmar» of a gym: the badge of its panel. */
  async countRequests(gymEntityId: string): Promise<number> {
    const [row] = await this.sequelize.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM directory.affiliations WHERE gym_entity_id = :gymEntityId AND status = 'REQUESTED'`,
      { type: QueryTypes.SELECT, replacements: { gymEntityId } },
    );
    return row?.count ?? 0;
  }
}

const ownWhere = (subject: Subject) => (subject.type === 'PERSON' ? 'a.user_id = :ownerId' : 'a.coach_entity_id = :ownerId');
const ownReplacements = (subject: Subject) => ({ ownerId: subject.type === 'PERSON' ? subject.userId : subject.entityId });
const pageReplacements = (page: Page) => ({ afterAt: page.after?.key ?? null, afterId: page.after?.id ?? null, limit: page.limit });
