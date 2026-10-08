import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { RoutineStatus, RoutineVisibility } from '../../common/enums/domain.enums';
import { UserModel } from '../users/user.model';
import { RoutineAccessService } from './routine-access.service';
import { RoutineNotifier } from './routine-notifier';
import { RoutineShareModel } from './routine-share.model';
import { RoutineSharesRepository } from './routine-shares.repository';
import { TrainingRepository } from './training.repository';

type Actor = { id: string; role: import('../../common/enums/domain.enums').UserRole; tenantId: string };

export type ShareResponse = {
  id: string;
  rutinaId: string;
  invitadoId: string;
  invitadoNombre: string | null;
  estado: string;
  origen: string;
  respondidaEn: Date | null;
  creadaEn: Date;
};

export type InviteResult = {
  creados: ShareResponse[];
  omitidos: Array<{ usuarioId: string; motivo: 'YA_INVITADO' | 'ES_EL_AUTOR' | 'USUARIO_NO_ENCONTRADO' }>;
};

/** Compartir una rutina privada con invitación aceptar/rechazar (RF-13, D4). */
@Injectable()
export class RoutineSharingService {
  constructor(
    private readonly shares: RoutineSharesRepository,
    private readonly routines: TrainingRepository,
    private readonly access: RoutineAccessService,
    private readonly notifier: RoutineNotifier,
  ) {}

  async invite(owner: Actor, routineId: string, userIds: readonly string[]): Promise<InviteResult> {
    const routine = await this.routines.findRoutineById(routineId);
    if (!routine) throw new NotFoundException('Rutina no encontrada.');
    await this.access.assertCanEdit(owner, routine);
    if (routine.status !== RoutineStatus.ACTIVE || routine.visibility === RoutineVisibility.PUBLIC) {
      throw new BadRequestException('Solo se comparten rutinas privadas.');
    }
    const unique = [...new Set(userIds)];
    const users = new Map((await this.shares.findUsers(unique)).map((u) => [u.id, u]));
    const creados: ShareResponse[] = [];
    const omitidos: InviteResult['omitidos'] = [];
    const ownerName = (await this.shares.findUsers([owner.id]))[0]?.fullName ?? 'Alguien';

    for (const id of unique) {
      const invitee = users.get(id);
      if (id === owner.id) {
        omitidos.push({ usuarioId: id, motivo: 'ES_EL_AUTOR' });
      } else if (!invitee || !this.shares.isActive(invitee) || invitee.tenantId !== owner.tenantId) {
        omitidos.push({ usuarioId: id, motivo: 'USUARIO_NO_ENCONTRADO' });
      } else if (await this.shares.findLiveShare(routineId, id)) {
        omitidos.push({ usuarioId: id, motivo: 'YA_INVITADO' });
      } else {
        const share = await this.shares.createInvitation(routineId, owner.id, id);
        creados.push(this.toResponse(share, invitee));
        await this.notifier.notify({
          to: id,
          type: 'ROUTINE_SHARE_INVITE',
          subject: 'Te compartieron una rutina',
          body: `${ownerName} te compartió la rutina "${routine.name}"`,
          dedupeKey: share.id,
          refs: { routineId, shareId: share.id },
        });
      }
    }
    return { creados, omitidos };
  }

  async listForRoutine(owner: Actor, routineId: string): Promise<ShareResponse[]> {
    const routine = await this.routines.findRoutineById(routineId);
    if (!routine) throw new NotFoundException('Rutina no encontrada.');
    await this.access.assertCanEdit(owner, routine);
    const shares = await this.shares.listForRoutine(routineId);
    const users = new Map(
      (await this.shares.findUsers(shares.map((s) => s.inviteeId))).map((u) => [u.id, u]),
    );
    return shares.map((s) => this.toResponse(s, users.get(s.inviteeId) ?? null));
  }

  async revoke(owner: Actor, routineId: string, shareId: string): Promise<ShareResponse> {
    const routine = await this.routines.findRoutineById(routineId);
    if (!routine) throw new NotFoundException('Rutina no encontrada.');
    await this.access.assertCanEdit(owner, routine);
    const share = await this.shares.findById(shareId);
    if (!share || share.routineId !== routineId) throw new NotFoundException('Invitación no encontrada.');
    if (share.status === 'PENDING' || share.status === 'ACCEPTED') {
      await share.update({ status: 'REVOKED', respondedAt: new Date() });
    }
    return this.toResponse(share, null);
  }

  /** Invitaciones del usuario (contador de la pestaña «Compartidas conmigo»). */
  async myInvitations(userId: string, status?: 'PENDING' | 'ACCEPTED') {
    const shares = await this.shares.listForInvitee(userId, status);
    const routines = await Promise.all(shares.map((s) => this.routines.findRoutineById(s.routineId)));
    const owners = new Map(
      (await this.shares.findUsers(shares.map((s) => s.ownerId))).map((u) => [u.id, u]),
    );
    return shares.map((share, index) => ({
      id: share.id,
      estado: share.status,
      origen: share.origin,
      rutina: routines[index]
        ? { id: routines[index].id, nombre: routines[index].name, dias: routines[index].days?.length ?? 0 }
        : null,
      deParte: { id: share.ownerId, nombre: owners.get(share.ownerId)?.fullName ?? '' },
      creadaEn: share.createdAt,
    }));
  }

  accept(userId: string, shareId: string) {
    return this.respond(userId, shareId, 'ACCEPTED');
  }

  decline(userId: string, shareId: string) {
    return this.respond(userId, shareId, 'DECLINED');
  }

  /** Idempotente: responder de nuevo a una invitación ya respondida devuelve su estado sin tocar nada. */
  private async respond(userId: string, shareId: string, next: 'ACCEPTED' | 'DECLINED') {
    const share = await this.shares.findById(shareId);
    // Otra persona no puede ni saber que la invitación existe.
    if (!share || share.inviteeId !== userId) throw new NotFoundException('Invitación no encontrada.');
    if (share.status !== 'PENDING') return this.toResponse(share, null);
    await share.update({ status: next, respondedAt: new Date() });
    const routine = await this.routines.findRoutineById(share.routineId);
    const [invitee] = await this.shares.findUsers([userId]);
    await this.notifier.notify({
      to: share.ownerId,
      type: next === 'ACCEPTED' ? 'ROUTINE_SHARE_ACCEPTED' : 'ROUTINE_SHARE_DECLINED',
      subject: next === 'ACCEPTED' ? 'Aceptaron tu rutina' : 'No aceptaron tu rutina',
      body: `${invitee?.fullName ?? 'Alguien'} ${next === 'ACCEPTED' ? 'aceptó' : 'no aceptó'} tu rutina "${routine?.name ?? ''}"`,
      dedupeKey: `${share.id}:${next}`,
      refs: { routineId: share.routineId, shareId: share.id },
    });
    return this.toResponse(share, invitee ?? null);
  }

  private toResponse(share: RoutineShareModel, invitee: UserModel | null): ShareResponse {
    return {
      id: share.id,
      rutinaId: share.routineId,
      invitadoId: share.inviteeId,
      invitadoNombre: invitee?.fullName ?? null,
      estado: share.status,
      origen: share.origin,
      respondidaEn: share.respondedAt,
      creadaEn: share.createdAt,
    };
  }
}
