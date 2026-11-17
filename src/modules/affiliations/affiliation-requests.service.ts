import { HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
import { Transaction } from 'sequelize';
import { DomainException } from '../../common/errors/domain.exception';
import { AuthenticatedUser } from '../../common/types/auth-context.types';
import { normalizeHandle } from '../business-accounts/handle-rules';
import { BusinessAccountsRepository } from '../business-accounts/business-accounts.repository';
import { decodeKeyset, encodeCursor } from '../business-listings/keyset-cursor';
import { AFFILIATION_LIMITS, AffiliationKind, cooldownUntil, invalidTransition, wrongBusinessType } from './affiliation.catalog';
import { AffiliationNotices } from './affiliation-notices';
import { AffiliationViewsRepository } from './affiliation-views.repository';
import { AffiliationRow, AffiliationUniqueError, AffiliationsRepository, GymRow, Subject } from './affiliations.repository';
import { OwnAffiliationDto, mapOwnAffiliation } from './affiliations.mapper';
import { OwnListQuery } from './affiliations.schemas';

/** What a subject asks: the gym, the kind, the declared location and (persons only) the CI digits. */
export type SubjectRequest = {
  gymHandle?: string;
  gymEntityId?: string;
  kind: AffiliationKind;
  locationId?: string;
  ciLast3: string | null;
  switchGym: boolean;
};

function conflict(code: 'AFFILIATION_ALREADY_LIVE' | 'AFFILIATION_SOCIO_PENDING' | 'AFFILIATION_LIMIT' | 'AFFILIATION_COOLDOWN' | 'SOCIO_OF_ANOTHER_GYM', message: string, details: Record<string, unknown>) {
  return new DomainException(HttpStatus.CONFLICT, code, message, details);
}

function gymNotFound(): NotFoundException {
  return new NotFoundException('Gimnasio no encontrado.');
}

function affiliationNotFound(): NotFoundException {
  return new NotFoundException('Afiliación no encontrada.');
}

/**
 * The subject's side of an affiliation (ADR-0025): a person (`me/affiliations`)
 * or a coach business (`business/me/gym-links`) asks a public gym, lists its
 * own rows, cancels a pending one or leaves a confirmed one. Someone else's
 * row is never found (404).
 */
@Injectable()
export class AffiliationRequestsService {
  constructor(
    private readonly repository: AffiliationsRepository,
    private readonly views: AffiliationViewsRepository,
    private readonly accounts: BusinessAccountsRepository,
    private readonly notices: AffiliationNotices,
  ) {}

  personOf(actor: AuthenticatedUser): Subject {
    return { type: 'PERSON', userId: actor.id };
  }

  /** The coach business of the actor; a gym or a store is refused (BFLA, 403). */
  async coachOf(actor: AuthenticatedUser): Promise<Subject & { type: 'COACH' }> {
    const account = await this.accounts.findByUserId(actor.id);
    if (!account) throw new NotFoundException('Cuenta de negocio no encontrada.');
    if (account.entityType !== 'COACH') throw wrongBusinessType('COACH');
    return { type: 'COACH', entityId: account.entityId, ownerUserId: actor.id };
  }

  async request(subject: Subject, input: SubjectRequest): Promise<OwnAffiliationDto> {
    const id = await this.repository.transaction(async (transaction) => {
      await this.repository.lockSubject(subject, transaction);
      if (subject.type === 'COACH') await this.assertCoachPublic(subject.entityId);
      const gym = await this.publicGym(input, transaction);
      if (input.locationId && !(await this.repository.locationOfGym(gym.entityId, input.locationId, transaction))) {
        throw new DomainException(HttpStatus.BAD_REQUEST, 'AFFILIATION_LOCATION_INVALID', 'Esa sede no es de este gimnasio.');
      }
      const replacesId = await this.assertMayRequest(subject, gym, input, transaction);
      const affiliationId = await this.repository
        .insert({ subject, gymEntityId: gym.entityId, kind: input.kind, locationId: input.locationId ?? null, ciLast3: input.ciLast3, replacesId }, transaction)
        .catch((error: unknown) => {
          // The unique indexes are the last word under concurrency: a parallel request lost the race.
          if (error instanceof AffiliationUniqueError) throw conflict('AFFILIATION_ALREADY_LIVE', 'Ya tienes una solicitud o afiliación así.', {});
          throw error;
        });
      await this.notices.send(gym.ownerUserId, { id: affiliationId, kind: input.kind }, { event: 'REQUESTED', subject: subject.type }, transaction);
      return affiliationId;
    });
    return this.get(subject, id);
  }

  async list(subject: Subject, query: OwnListQuery): Promise<{ items: OwnAffiliationDto[]; nextCursor: string | null }> {
    const rows = await this.views.listOwn(subject, { after: decodeKeyset(query.cursor), limit: query.limit + 1 });
    const page = rows.slice(0, query.limit);
    const last = page[page.length - 1];
    return {
      items: page.map((row) => mapOwnAffiliation(row, subject.type)),
      nextCursor: rows.length > query.limit && last ? encodeCursor(last.cursorKey, last.id) : null,
    };
  }

  async get(subject: Subject, affiliationId: string): Promise<OwnAffiliationDto> {
    const row = await this.views.findOwn(subject, affiliationId);
    if (!row) throw affiliationNotFound();
    return mapOwnAffiliation(row, subject.type);
  }

  /** REQUESTED → CANCELLED: the subject withdraws a request the gym has not answered. */
  cancel(subject: Subject, affiliationId: string): Promise<OwnAffiliationDto> {
    return this.close(subject, affiliationId, 'REQUESTED');
  }

  /** CONFIRMED → ENDED: the subject is no longer a member or coach of that gym. */
  end(subject: Subject, affiliationId: string): Promise<OwnAffiliationDto> {
    return this.close(subject, affiliationId, 'CONFIRMED');
  }

  private async close(subject: Subject, affiliationId: string, from: 'REQUESTED' | 'CONFIRMED'): Promise<OwnAffiliationDto> {
    await this.repository.transaction(async (transaction) => {
      await this.repository.lockSubject(subject, transaction);
      // Ownership before the row lock: a foreign id is 404 without ever locking someone else's row.
      const owns = (row: AffiliationRow | null) => row && (subject.type === 'PERSON' ? row.userId === subject.userId : row.coachEntityId === subject.entityId);
      if (!owns(await this.repository.find(affiliationId, transaction))) throw affiliationNotFound();
      const row = await this.repository.lock(affiliationId, transaction);
      if (!row || !owns(row)) throw affiliationNotFound();
      if (row.status !== from) throw invalidTransition(row.status);
      await this.repository.transition(
        affiliationId,
        {
          status: from === 'REQUESTED' ? 'CANCELLED' : 'ENDED',
          changedByUserId: subject.type === 'PERSON' ? subject.userId : subject.ownerUserId,
          reasonCode: from === 'REQUESTED' ? 'WITHDRAWN' : 'LEFT',
        },
        transaction,
      );
    });
    return this.get(subject, affiliationId);
  }

  /** Only a public gym receives requests: a draft, paused, suspended or unknown one is 404 alike. */
  private async publicGym(input: SubjectRequest, transaction: Transaction): Promise<GymRow> {
    const handle = input.gymHandle === undefined ? null : normalizeHandle(input.gymHandle);
    if (input.gymHandle !== undefined && !handle) throw gymNotFound();
    const gym = await this.repository.findGym(handle ? { handle } : { entityId: input.gymEntityId ?? '' }, transaction);
    if (!gym || gym.status !== 'ACTIVE') throw gymNotFound();
    return gym;
  }

  /** A coach business that is not public has no card to show the gym. */
  private async assertCoachPublic(entityId: string): Promise<void> {
    const entity = await this.accounts.findEntity(entityId);
    if (entity?.status !== 'ACTIVE') {
      throw new DomainException(HttpStatus.CONFLICT, 'COACH_NOT_PUBLIC', 'Tu perfil de coach debe estar publicado para pedir un vínculo.');
    }
  }

  /**
   * Counted under the subject's lock. Returns the confirmed SOCIO this request
   * replaces (a «cambio de gimnasio»), or null.
   */
  private async assertMayRequest(subject: Subject, gym: GymRow, input: SubjectRequest, transaction: Transaction): Promise<string | null> {
    const live = await this.repository.liveOf(subject, transaction);
    const same = live.find((row) => row.gymEntityId === gym.entityId && row.kind === input.kind);
    if (same) throw conflict('AFFILIATION_ALREADY_LIVE', 'Ya tienes una solicitud o afiliación con este gimnasio.', { affiliationId: same.id, status: same.status });
    const pending = live.filter((row) => row.status === 'REQUESTED');
    let replacesId: string | null = null;
    if (input.kind === 'SOCIO') {
      const pendingSocio = pending.find((row) => row.kind === 'SOCIO');
      if (pendingSocio) throw conflict('AFFILIATION_SOCIO_PENDING', 'Ya pediste ser socio de otro gimnasio; cancela esa solicitud primero.', { affiliationId: pendingSocio.id });
      const current = live.find((row) => row.kind === 'SOCIO' && row.status === 'CONFIRMED');
      if (current && !input.switchGym) {
        throw conflict('SOCIO_OF_ANOTHER_GYM', 'Ya eres socio de otro gimnasio. Puedes pedir el cambio: se hará cuando el nuevo gimnasio te confirme.', {
          affiliationId: current.id,
          action: 'SWITCH_GYM',
        });
      }
      replacesId = current?.id ?? null;
    }
    const max = subject.type === 'PERSON' ? AFFILIATION_LIMITS.personPending : AFFILIATION_LIMITS.coachPending;
    if (pending.length >= max) throw conflict('AFFILIATION_LIMIT', 'Tienes demasiadas solicitudes pendientes; espera respuesta o cancela alguna.', { max });
    const until = cooldownUntil(await this.repository.lastClosed(subject, gym.entityId, input.kind, transaction), new Date());
    if (until) throw conflict('AFFILIATION_COOLDOWN', 'Todavía no puedes volver a pedirlo a este gimnasio.', { retryAfter: until.toISOString() });
    return replacesId;
  }
}
