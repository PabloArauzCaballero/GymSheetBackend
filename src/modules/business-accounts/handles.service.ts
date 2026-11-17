import { HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
import { Transaction, UniqueConstraintError } from 'sequelize';
import { DomainException } from '../../common/errors/domain.exception';
import { DirectoryEntityDetailDto } from '../directory/directory.mapper';
import { DirectoryService } from '../directory/directory.service';
import { DirectoryEntityModel } from '../directory/directory-entity.model';
import {
  HandleRejection,
  PENDING_HANDLE_TTL_DAYS,
  RETIRED_LOCK_DAYS,
  RETIRED_REDIRECT_DAYS,
  addDays,
  normalizeHandle,
  parseHandle,
  pendingReservationOpen,
  renameAllowed,
} from './handle-rules';
import { HandleRow, HandlesRepository } from './handles.repository';

export type HandleAvailabilityReason = 'TAKEN' | 'RESERVED' | 'INVALID' | 'TOO_SIMILAR';
export type HandleAvailability = { handle: string | null; available: boolean; reason: HandleAvailabilityReason | null };
export type CurrentHandle = { handle: string; status: 'PENDING' | 'ACTIVE' };
export type ResolvedHandle = { handle: string; entity: DirectoryEntityDetailDto } | { redirectTo: string };

const REJECTION_ERRORS: Record<HandleRejection, () => DomainException> = {
  INVALID: () =>
    new DomainException(
      HttpStatus.UNPROCESSABLE_ENTITY,
      'HANDLE_INVALID',
      'Usa de 3 a 30 letras, números, punto o guion bajo; sin empezar ni terminar con un separador y no solo números.',
    ),
  RESERVED: () => new DomainException(HttpStatus.UNPROCESSABLE_ENTITY, 'HANDLE_RESERVED', 'Ese nombre está reservado.'),
};

/** Why another holder blocks a handle: the exact handle is taken; a look-alike is too similar. */
function holderReason(handle: string, holders: readonly HandleRow[]): HandleAvailabilityReason | null {
  if (holders.length === 0) return null;
  if (holders.some((row) => row.status === 'RESERVED')) return 'RESERVED';
  return holders.some((row) => row.handle === handle) ? 'TAKEN' : 'TOO_SIMILAR';
}

function holderError(reason: HandleAvailabilityReason): DomainException {
  if (reason === 'RESERVED') return REJECTION_ERRORS.RESERVED();
  if (reason === 'TAKEN') return new DomainException(HttpStatus.CONFLICT, 'HANDLE_TAKEN', 'Ese nombre ya está en uso.');
  return new DomainException(
    HttpStatus.UNPROCESSABLE_ENTITY,
    'HANDLE_TOO_SIMILAR',
    'Se parece demasiado a un nombre que ya existe. Prueba con otro.',
  );
}

/**
 * The public `@handle` namespace (ADR-0020, plan §2.2). A handle chosen while
 * the listing is DRAFT is a PENDING reservation, invisible to the public; it
 * becomes ACTIVE when the KYC approves the listing (franja 8b). Renaming a
 * public handle is limited and leaves a redirect.
 */
@Injectable()
export class HandlesService {
  constructor(
    private readonly repository: HandlesRepository,
    private readonly directory: DirectoryService,
  ) {}

  async availability(input: string, now = new Date()): Promise<HandleAvailability> {
    const parsed = parseHandle(input);
    // The normalized form travels back even when refused, so the client shows what was checked.
    if ('rejection' in parsed) return { handle: normalizeHandle(input), available: false, reason: parsed.rejection };
    const reason = holderReason(parsed.handle, await this.repository.findHolders(parsed.skeleton, null, now));
    return { handle: parsed.handle, available: reason === null, reason };
  }

  async current(entityId: string, now = new Date()): Promise<CurrentHandle | null> {
    const row = await this.repository.findCurrent(entityId, now);
    return row ? { handle: row.handle, status: row.status === 'ACTIVE' ? 'ACTIVE' : 'PENDING' } : null;
  }

  /**
   * Claims `input` for a listing already locked by the caller (`entity` read
   * FOR UPDATE in `transaction`). DRAFT: replaces the PENDING reservation,
   * only while the listing's reservation window is open; re-claiming the same
   * handle changes nothing, so it never extends the window. ACTIVE: a public
   * rename, within the limits, retiring the old handle.
   */
  async claim(
    entity: DirectoryEntityModel,
    input: string,
    actorUserId: string,
    transaction: Transaction,
    now = new Date(),
  ): Promise<CurrentHandle> {
    const parsed = parseHandle(input);
    if ('rejection' in parsed) throw REJECTION_ERRORS[parsed.rejection]();
    const { handle, skeleton } = parsed;
    if (entity.status !== 'DRAFT' && entity.status !== 'ACTIVE') {
      throw new DomainException(HttpStatus.CONFLICT, 'BUSINESS_ACCOUNT_LOCKED', 'Tu negocio no puede cambiar de nombre en este estado.');
    }
    // The KYC takes the listing out of DRAFT; until it is sent once (ADR-0021) the window does not reopen.
    if (
      entity.status === 'DRAFT' &&
      !pendingReservationOpen(entity.createdAt, now) &&
      !(await this.repository.hasSubmittedKyc(entity.id, transaction))
    ) {
      throw new DomainException(
        HttpStatus.CONFLICT,
        'HANDLE_RESERVATION_EXPIRED',
        `Tu reserva de nombre venció: pasaron ${PENDING_HANDLE_TTL_DAYS} días desde el alta sin verificar tu negocio.`,
      );
    }

    await this.repository.lockSkeleton(skeleton, transaction);
    await this.repository.deleteExpired(skeleton, entity.id, now, transaction);
    const current = await this.repository.findCurrent(entity.id, now, transaction);
    if (current?.handle === handle) return { handle, status: current.status === 'ACTIVE' ? 'ACTIVE' : 'PENDING' };
    const blocked = holderReason(handle, await this.repository.findHolders(skeleton, entity.id, now, transaction));
    if (blocked) throw holderError(blocked);

    try {
      return entity.status === 'DRAFT'
        ? await this.reserve(entity.id, handle, skeleton, current, transaction)
        : await this.rename(entity.id, handle, skeleton, current, actorUserId, transaction, now);
    } catch (error: unknown) {
      // A concurrent claim of the same handle through another skeleton path.
      if (error instanceof UniqueConstraintError) throw holderError('TAKEN');
      throw error;
    }
  }

  /** Public resolution: the listing, a redirect from a retired handle, or 404. */
  async resolve(input: string, now = new Date()): Promise<ResolvedHandle> {
    const parsed = parseHandle(input);
    const row = 'rejection' in parsed ? null : await this.repository.findByHandle(parsed.handle);
    if (row?.status === 'ACTIVE' && row.ownerEntityId) {
      return { handle: row.handle, entity: await this.directory.getEntityById(row.ownerEntityId) };
    }
    if (row?.status === 'RETIRED' && row.redirectToHandle && row.redirectUntil && row.redirectUntil > now) {
      const target = await this.repository.findByHandle(row.redirectToHandle);
      if (target?.status === 'ACTIVE') return { redirectTo: target.handle };
    }
    throw new NotFoundException('Negocio no encontrado.');
  }

  private async reserve(
    entityId: string,
    handle: string,
    skeleton: string,
    current: HandleRow | null,
    transaction: Transaction,
  ): Promise<CurrentHandle> {
    if (current) await this.repository.deleteHandle(current.handle, transaction);
    await this.repository.insert({ handle, skeleton, ownerEntityId: entityId, status: 'PENDING' }, transaction);
    return { handle, status: 'PENDING' };
  }

  private async rename(
    entityId: string,
    handle: string,
    skeleton: string,
    current: HandleRow | null,
    actorUserId: string,
    transaction: Transaction,
    now: Date,
  ): Promise<CurrentHandle> {
    if (current && !renameAllowed(await this.repository.listPublicRenameTimes(entityId, transaction), now)) {
      throw new DomainException(
        HttpStatus.TOO_MANY_REQUESTS,
        'HANDLE_RENAME_LIMIT',
        'Puedes cambiar tu nombre una vez cada 30 días y hasta tres veces al año.',
      );
    }
    if (current) {
      await this.repository.retire(
        current.handle,
        { redirectTo: handle, redirectUntil: addDays(now, RETIRED_REDIRECT_DAYS), lockedUntil: addDays(now, RETIRED_LOCK_DAYS) },
        transaction,
      );
      await this.repository.repointRedirects(entityId, handle, transaction);
    }
    const own = await this.repository.findByHandle(handle, transaction);
    if (own?.ownerEntityId === entityId) await this.repository.reactivate(handle, transaction);
    else await this.repository.insert({ handle, skeleton, ownerEntityId: entityId, status: 'ACTIVE' }, transaction);
    await this.repository.recordChange(
      { entityId, from: current?.handle ?? null, to: handle, actorUserId, reason: 'USER' },
      transaction,
    );
    return { handle, status: 'ACTIVE' };
  }
}
