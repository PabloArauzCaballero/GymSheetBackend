import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { UniqueConstraintError } from "sequelize";
import { ProgressionRepository } from "./progression.repository";
import {
  CreateBadgeInput,
  CreateLevelInput,
  UpdateBadgeInput,
  UpdateLevelInput,
} from "./progression.schemas";

/**
 * Administración del catálogo de la senda.
 *
 * Separado de `ProgressionService` porque no comparten nada salvo el
 * repositorio: uno lee entrenamientos y calcula, el otro edita filas. Juntarlos
 * habría metido las reglas de autorización de administración en el camino de la
 * pantalla que abre cada socio.
 */
@Injectable()
export class ProgressionAdminService {
  constructor(private readonly repository: ProgressionRepository) {}

  listLevels() {
    return this.repository.listAllLevels();
  }

  listBadges() {
    return this.repository.listAllBadges();
  }

  async createLevel(input: CreateLevelInput) {
    return this.guardUniqueness(
      () => this.repository.createLevel(input),
      "Ya existe un rango con ese código para ese gimnasio y esa audiencia.",
    );
  }

  async updateLevel(id: string, input: UpdateLevelInput) {
    const level = await this.repository.findLevelById(id);
    if (!level) throw new NotFoundException("Rango no encontrado.");
    return this.guardUniqueness(
      () => level.update(input),
      "Ya existe un rango con ese código para ese gimnasio y esa audiencia.",
    );
  }

  /**
   * Desactiva en vez de borrar.
   *
   * Las insignias ya conseguidas apuntan a su fila; borrarla las haría
   * desaparecer del historial de quien las ganó. Un rango retirado deja de
   * aparecer en la senda pero no reescribe el pasado de nadie.
   */
  async deactivateLevel(id: string) {
    const level = await this.repository.findLevelById(id);
    if (!level) throw new NotFoundException("Rango no encontrado.");
    await level.update({ active: false });
    return { id, active: false };
  }

  async createBadge(input: CreateBadgeInput) {
    return this.guardUniqueness(
      () =>
        this.repository.createBadge({
          ...input,
          criterionThreshold: input.criterionThreshold.toFixed(2),
        }),
      "Ya existe una insignia con ese código para ese gimnasio y esa audiencia.",
    );
  }

  async updateBadge(id: string, input: UpdateBadgeInput) {
    const badge = await this.repository.findBadgeById(id);
    if (!badge) throw new NotFoundException("Insignia no encontrada.");
    const { criterionThreshold, ...rest } = input;
    return this.guardUniqueness(
      () =>
        badge.update({
          ...rest,
          ...(criterionThreshold !== undefined
            ? { criterionThreshold: criterionThreshold.toFixed(2) }
            : {}),
        }),
      "Ya existe una insignia con ese código para ese gimnasio y esa audiencia.",
    );
  }

  async deactivateBadge(id: string) {
    const badge = await this.repository.findBadgeById(id);
    if (!badge) throw new NotFoundException("Insignia no encontrada.");
    await badge.update({ active: false });
    return { id, active: false };
  }

  private async guardUniqueness<T>(operation: () => Promise<T>, message: string): Promise<T> {
    try {
      return await operation();
    } catch (error: unknown) {
      if (error instanceof UniqueConstraintError) throw new ConflictException(message);
      throw error;
    }
  }
}
