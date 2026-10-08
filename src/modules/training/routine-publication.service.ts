import { Injectable, NotFoundException } from '@nestjs/common';
import { Sequelize } from 'sequelize-typescript';
import { RoutineStatus, RoutineVisibility, UserRole } from '../../common/enums/domain.enums';
import { DomainException } from '../../common/errors/domain.exception';
import { RoutineAccessService } from './routine-access.service';
import { RoutineDaysRepository } from './routine-days.repository';
import { RoutineStructureService } from './routine-structure.service';
import { RoutineModel } from './routine.model';
import { RoutineResponse, mapRoutineToResponse } from './training.mapper';
import { TrainingRepository } from './training.repository';
import { canEditRoutine } from './routine-access.policy';

type Actor = { id: string; role: UserRole; tenantId: string };

/** Publicar, despublicar, copiar y sincronizar una copia con su original (RF-09, RF-10). */
@Injectable()
export class RoutinePublicationService {
  constructor(
    private readonly routines: TrainingRepository,
    private readonly days: RoutineDaysRepository,
    private readonly access: RoutineAccessService,
    private readonly structure: RoutineStructureService,
    private readonly sequelize: Sequelize,
  ) {}

  /**
   * PRIVATE → PUBLIC. Exige estructura completa y que no exista otra pública con
   * los mismos ejercicios (índice único parcial sobre la huella): una copia sin
   * cambios no se puede publicar, una hecha de cero sí.
   */
  async publish(actor: Actor, routineId: string): Promise<RoutineResponse> {
    const routine = await this.load(routineId);
    await this.access.assertCanEdit(actor, routine);
    if (routine.moderationState !== 'VISIBLE') {
      throw new DomainException(403, 'CONTENT_HIDDEN', 'Esta rutina está oculta por moderación.');
    }
    if (routine.status !== RoutineStatus.ACTIVE) {
      throw new NotFoundException('Rutina no encontrada.');
    }
    this.assertComplete(routine);
    if (routine.visibility !== RoutineVisibility.PUBLIC) {
      const fingerprint = await this.days.computeFingerprint(routine.id);
      try {
        await this.sequelize.transaction(async (transaction) => {
          await routine.update(
            {
              visibility: RoutineVisibility.PUBLIC,
              publishedAt: new Date(),
              fingerprint,
              authorTenantId: routine.authorTenantId ?? actor.tenantId,
            },
            { transaction },
          );
        });
      } catch (error: unknown) {
        throw await this.structure.translateDuplicate(error, fingerprint);
      }
    }
    return this.respond(actor, routine.id);
  }

  async unpublish(actor: Actor, routineId: string): Promise<RoutineResponse> {
    const routine = await this.load(routineId);
    await this.access.assertCanEdit(actor, routine);
    if (routine.isOfficial) {
      throw new DomainException(403, 'OFFICIAL_FORBIDDEN', 'Una rutina oficial solo la gestiona REPP.');
    }
    if (routine.visibility === RoutineVisibility.PUBLIC) {
      await routine.update({ visibility: RoutineVisibility.PRIVATE, publishedAt: null });
    }
    return this.respond(actor, routine.id);
  }

  /**
   * Copia privada con la atribución congelada del creador original. Si la
   * fuente ya es una copia, la marca de agua sigue apuntando al creador de la
   * base, no a quien la copió en medio.
   */
  async copy(actor: Actor, routineId: string): Promise<RoutineResponse> {
    const source = await this.load(routineId);
    await this.access.assertFullView(actor, source);
    const author = (await this.routines.findAuthorName(source.createdByUserId)) ?? 'Usuario eliminado';
    const isOwn = source.createdByUserId === actor.id;
    const attribution =
      source.attribution ??
      (isOwn ? null : { routineName: source.name, authorId: source.createdByUserId, authorName: author });

    const copyId = await this.sequelize.transaction(async (transaction) => {
      const copy = await this.routines.createRoutine(
        actor.id,
        {
          name: source.name,
          description: source.description,
          visibility: RoutineVisibility.PRIVATE,
          goal: source.goal,
          durationWeeks: source.durationWeeks,
          progression: null,
        },
        actor.tenantId,
        transaction,
      );
      await copy.update(
        {
          progressionConfig: source.progressionConfig,
          basedOnRoutineId: source.id,
          basedOnVersion: source.version,
          attribution,
        },
        { transaction },
      );
      await this.days.replaceStructure(copy.id, this.cloneDays(source), transaction);
      await this.structure.afterStructureChange(copy, transaction);
      await source.increment('copiesCount', { transaction });
      return copy.id;
    });
    return this.respond(actor, copyId);
  }

  /**
   * Aplica la versión nueva del original a mi copia (D2: nunca se hace sola).
   * Conserva nombre, descripción y ajustes de semana.
   */
  async syncFromSource(actor: Actor, routineId: string): Promise<RoutineResponse & { actualizada: boolean }> {
    const copy = await this.load(routineId);
    await this.access.assertCanEdit(actor, copy);
    const source = copy.basedOnRoutineId ? await this.routines.findRoutineById(copy.basedOnRoutineId) : null;
    if (!source || source.status !== RoutineStatus.ACTIVE) {
      throw new NotFoundException('El original ya no está disponible.');
    }
    await this.access.assertFullView(actor, source);
    const stale = (copy.basedOnVersion ?? 0) < source.version;
    if (stale) {
      await this.sequelize.transaction(async (transaction) => {
        await this.days.replaceStructure(copy.id, this.cloneDays(source), transaction);
        await copy.update({ basedOnVersion: source.version }, { transaction });
        await this.structure.afterStructureChange(copy, transaction);
      });
    }
    return { ...(await this.respond(actor, copy.id)), actualizada: stale };
  }

  private cloneDays(source: RoutineModel) {
    const flat = [...(source.exercises ?? [])].sort((a, b) => a.order - b.order);
    return [...(source.days ?? [])]
      .sort((a, b) => a.order - b.order)
      .map((day) => ({
        weekday: day.weekday,
        name: day.name,
        exercises: flat
          .filter((e) => e.routineDayId === day.id)
          .map((e) => ({
            exerciseId: e.exerciseId,
            targetSets: e.targetSets,
            repsMin: e.repsMin,
            repsMax: e.repsMax,
            targetWeightKg: e.targetWeightKg == null ? null : Number(e.targetWeightKg),
            targetRir: e.targetRir,
            restSeconds: e.restSeconds,
            note: e.note,
          })),
      }));
  }

  private assertComplete(routine: RoutineModel): void {
    const flat = routine.exercises ?? [];
    const days = routine.days ?? [];
    if (days.length === 0 || days.some((d) => !flat.some((e) => e.routineDayId === d.id))) {
      throw new DomainException(
        400,
        'ROUTINE_HAS_NO_DAYS',
        'Para publicar, la rutina necesita al menos un día y cada día al menos un ejercicio.',
      );
    }
  }

  private async load(routineId: string): Promise<RoutineModel> {
    const routine = await this.routines.findRoutineById(routineId);
    if (!routine) throw new NotFoundException('Rutina no encontrada.');
    return routine;
  }

  private async respond(actor: Actor, routineId: string): Promise<RoutineResponse> {
    const routine = await this.load(routineId);
    return mapRoutineToResponse(routine, { id: actor.id, canEdit: canEditRoutine(actor, routine) });
  }
}
