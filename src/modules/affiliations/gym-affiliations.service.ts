import { HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
import { Transaction } from 'sequelize';
import { DomainException } from '../../common/errors/domain.exception';
import { AuthenticatedUser } from '../../common/types/auth-context.types';
import { BusinessAccountsRepository } from '../business-accounts/business-accounts.repository';
import { decodeKeyset, encodeCursor } from '../business-listings/keyset-cursor';
import { AffiliationKind, AffiliationStatus, invalidTransition, noteRequired, wrongBusinessType } from './affiliation.catalog';
import { AffiliationNotices } from './affiliation-notices';
import { AffiliationViewsRepository, GymViewRow } from './affiliation-views.repository';
import { AffiliationRow, AffiliationUniqueError, AffiliationsRepository, Subject } from './affiliations.repository';
import { GymAffiliationDto, mapGymAffiliation } from './affiliations.mapper';
import { EndAffiliationInput, GymConfirmedQuery, GymRequestsQuery, RejectAffiliationInput } from './affiliations.schemas';

type GymPage = { items: GymAffiliationDto[]; nextCursor: string | null };

function notFound(): NotFoundException {
  return new NotFoundException('Afiliación no encontrada.');
}

function gymNotActive(): DomainException {
  return new DomainException(HttpStatus.CONFLICT, 'GYM_NOT_ACTIVE', 'Tu gimnasio debe estar publicado para ver y decidir solicitudes.');
}

function subjectOf(row: AffiliationRow, ownerUserId: string | null): Subject {
  return row.userId ? { type: 'PERSON', userId: row.userId } : { type: 'COACH', entityId: row.coachEntityId ?? '', ownerUserId: ownerUserId ?? '' };
}

function pageOf(rows: GymViewRow[], limit: number): GymPage {
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  return { items: page.map(mapGymAffiliation), nextCursor: rows.length > limit && last ? encodeCursor(last.cursorKey, last.id) : null };
}

/**
 * The gym's side (ADR-0025, `business/me/affiliations*`): only a business
 * account whose entity is a GYM (anything else 403), and only rows of ITS gym
 * (anyone else's 404). The gym confirms, rejects or ends; REPP moderates and
 * the gym verifies nothing else. Pending requests (persons who are not yet
 * members) are read and decided only while the gym is public: a gym REPP
 * suspended keeps its members and coaches, never new people's data.
 */
@Injectable()
export class GymAffiliationsService {
  constructor(
    private readonly accounts: BusinessAccountsRepository,
    private readonly repository: AffiliationsRepository,
    private readonly views: AffiliationViewsRepository,
    private readonly notices: AffiliationNotices,
  ) {}

  async listRequests(actor: AuthenticatedUser, query: GymRequestsQuery): Promise<GymPage & { pendingCount: number }> {
    const gymId = await this.gymOf(actor);
    if (!(await this.isPublic(gymId))) throw gymNotActive();
    const [rows, pendingCount] = await Promise.all([
      this.views.listRequests(gymId, query, { after: decodeKeyset(query.cursor), limit: query.limit + 1 }),
      this.views.countRequests(gymId),
    ]);
    return { ...pageOf(rows, query.limit), pendingCount };
  }

  async listConfirmed(actor: AuthenticatedUser, kind: AffiliationKind, query: GymConfirmedQuery): Promise<GymPage> {
    const gymId = await this.gymOf(actor);
    const filter = kind === 'SOCIO' ? { locationId: query.locationId } : {};
    return pageOf(await this.views.listConfirmed(gymId, kind, filter, { after: decodeKeyset(query.cursor), limit: query.limit + 1 }), query.limit);
  }

  async get(actor: AuthenticatedUser, affiliationId: string): Promise<GymAffiliationDto> {
    const gymId = await this.gymOf(actor);
    const row = await this.views.findForGym(gymId, affiliationId);
    if (!row || (row.status === 'REQUESTED' && !(await this.isPublic(gymId)))) throw notFound();
    return mapGymAffiliation(row);
  }

  async confirm(actor: AuthenticatedUser, affiliationId: string): Promise<GymAffiliationDto> {
    const gymId = await this.gymOf(actor);
    await this.repository.transaction((transaction) => this.confirmInTransaction(gymId, affiliationId, actor.id, transaction));
    return this.get(actor, affiliationId);
  }

  /**
   * Confirms a REQUESTED affiliation of this gym inside the caller's
   * transaction: the hook 8e uses to confirm the SOCIO together with the
   * order that pays the subscription. A «cambio de gimnasio» ends the
   * person's confirmed SOCIO elsewhere in the same transaction, so there is
   * never a moment with two (and `ux_affiliations_confirmed_socio` holds it).
   */
  async confirmInTransaction(gymEntityId: string, affiliationId: string, actorUserId: string, transaction: Transaction): Promise<void> {
    const gym = await this.repository.findGym({ entityId: gymEntityId }, transaction);
    if (!gym) throw notFound();
    const row = await this.lockOwn(gymEntityId, affiliationId, 'REQUESTED', transaction);
    if (gym.status !== 'ACTIVE') throw gymNotActive();
    if (row.kind === 'SOCIO' && row.userId) await this.endPreviousSocio(row.userId, gymEntityId, transaction);
    await this.repository.transition(affiliationId, { status: 'CONFIRMED', changedByUserId: actorUserId }, transaction).catch((error: unknown) => {
      if (error instanceof AffiliationUniqueError) throw new DomainException(HttpStatus.CONFLICT, 'SOCIO_OF_ANOTHER_GYM', 'Esta persona ya es socia de otro gimnasio.');
      throw error;
    });
    const recipient = await this.repository.recipientOf(row, transaction);
    if (recipient) await this.notices.send(recipient, row, { event: 'CONFIRMED', gymName: gym.name }, transaction);
  }

  async reject(actor: AuthenticatedUser, affiliationId: string, input: RejectAffiliationInput): Promise<GymAffiliationDto> {
    return this.decide(actor, affiliationId, 'REQUESTED', 'REJECTED', input);
  }

  async end(actor: AuthenticatedUser, affiliationId: string, input: EndAffiliationInput): Promise<GymAffiliationDto> {
    return this.decide(actor, affiliationId, 'CONFIRMED', 'ENDED', input);
  }

  private async decide(
    actor: AuthenticatedUser,
    affiliationId: string,
    from: AffiliationStatus,
    to: 'REJECTED' | 'ENDED',
    input: RejectAffiliationInput | EndAffiliationInput,
  ): Promise<GymAffiliationDto> {
    if (input.reasonCode === 'OTHER' && !input.note) throw noteRequired();
    const gymId = await this.gymOf(actor);
    await this.repository.transaction(async (transaction) => {
      const gym = await this.repository.findGym({ entityId: gymId }, transaction);
      const row = await this.lockOwn(gymId, affiliationId, from, transaction);
      if (from === 'REQUESTED' && gym?.status !== 'ACTIVE') throw gymNotActive();
      await this.repository.transition(affiliationId, { status: to, changedByUserId: actor.id, reasonCode: input.reasonCode, reasonNote: input.note ?? null }, transaction);
      const recipient = await this.repository.recipientOf(row, transaction);
      if (recipient && gym) {
        await this.notices.send(recipient, row, { event: to, gymName: gym.name, reason: input.reasonCode, note: input.note ?? null }, transaction);
      }
    });
    return this.get(actor, affiliationId);
  }

  /** Subject lock first, then the row (the order every affiliation write uses), scoped to this gym. */
  private async lockOwn(gymEntityId: string, affiliationId: string, from: AffiliationStatus, transaction: Transaction): Promise<AffiliationRow> {
    const seen = await this.repository.find(affiliationId, transaction);
    if (!seen || seen.gymEntityId !== gymEntityId) throw notFound();
    await this.repository.lockSubject(subjectOf(seen, null), transaction);
    const row = await this.repository.lock(affiliationId, transaction);
    if (!row || row.gymEntityId !== gymEntityId) throw notFound();
    if (row.status !== from) throw invalidTransition(row.status);
    return row;
  }

  /** The person's confirmed SOCIO at another gym ends with `SWITCHED_GYM`; they are told. */
  private async endPreviousSocio(userId: string, newGymId: string, transaction: Transaction): Promise<void> {
    const previous = await this.repository.lockConfirmedSocio(userId, transaction);
    if (!previous || previous.gymEntityId === newGymId) return;
    await this.repository.transition(previous.id, { status: 'ENDED', changedByUserId: null, reasonCode: 'SWITCHED_GYM' }, transaction);
    const oldGym = await this.repository.findGym({ entityId: previous.gymEntityId }, transaction);
    await this.notices.send(userId, previous, { event: 'ENDED', gymName: oldGym?.name ?? 'tu gimnasio anterior', reason: 'SWITCHED_GYM', note: null }, transaction);
  }

  private async isPublic(gymEntityId: string): Promise<boolean> {
    return (await this.repository.findGym({ entityId: gymEntityId }))?.status === 'ACTIVE';
  }

  private async gymOf(actor: AuthenticatedUser): Promise<string> {
    const account = await this.accounts.findByUserId(actor.id);
    if (!account) throw new NotFoundException('Cuenta de negocio no encontrada.');
    if (account.entityType !== 'GYM') throw wrongBusinessType('GYM');
    return account.entityId;
  }
}
