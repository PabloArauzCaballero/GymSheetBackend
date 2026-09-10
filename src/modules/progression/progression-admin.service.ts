import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { UniqueConstraintError } from "sequelize";
import { resolveCatalogTenant } from "../../common/tenancy/catalog-scope";
import { AuthenticatedUser } from "../../common/types/auth-context.types";
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
 *
 * Todo método recibe el actor porque el gimnasio sobre el que se opera sale
 * SIEMPRE del token, nunca de la petición.
 */
@Injectable()
export class ProgressionAdminService {
  constructor(private readonly repository: ProgressionRepository) {}

  listLevels(actor: AuthenticatedUser) {
    return this.repository.listAllLevels(actor.tenantScope);
  }

  listBadges(actor: AuthenticatedUser) {
    return this.repository.listAllBadges(actor.tenantScope);
  }

  async createLevel(actor: AuthenticatedUser, input: CreateLevelInput) {
    const { alcance, ...values } = input;
    const tenantId = resolveCatalogTenant(actor, alcance);
    return this.guardUniqueness(
      () => this.repository.createLevel({ ...values, tenantId }),
      "Ya existe un rango con ese código para ese gimnasio y esa audiencia.",
    );
  }

  async updateLevel(actor: AuthenticatedUser, id: string, input: UpdateLevelInput) {
    const level = await this.repository.findLevelById(id);
    if (!level) throw new NotFoundException("Rango no encontrado.");
    this.assertEditable(actor, level.tenantId, "Rango no encontrado.");
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
  async deactivateLevel(actor: AuthenticatedUser, id: string) {
    const level = await this.repository.findLevelById(id);
    if (!level) throw new NotFoundException("Rango no encontrado.");
    this.assertEditable(actor, level.tenantId, "Rango no encontrado.");
    await level.update({ active: false });
    return { id, active: false };
  }

  async createBadge(actor: AuthenticatedUser, input: CreateBadgeInput) {
    const { alcance, ...values } = input;
    const tenantId = resolveCatalogTenant(actor, alcance);
    return this.guardUniqueness(
      () =>
        this.repository.createBadge({
          ...values,
          tenantId,
          criterionThreshold: values.criterionThreshold.toFixed(2),
        }),
      "Ya existe una insignia con ese código para ese gimnasio y esa audiencia.",
    );
  }

  async updateBadge(actor: AuthenticatedUser, id: string, input: UpdateBadgeInput) {
    const badge = await this.repository.findBadgeById(id);
    if (!badge) throw new NotFoundException("Insignia no encontrada.");
    this.assertEditable(actor, badge.tenantId, "Insignia no encontrada.");
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

  async deactivateBadge(actor: AuthenticatedUser, id: string) {
    const badge = await this.repository.findBadgeById(id);
    if (!badge) throw new NotFoundException("Insignia no encontrada.");
    this.assertEditable(actor, badge.tenantId, "Insignia no encontrada.");
    await badge.update({ active: false });
    return { id, active: false };
  }

  /**
   * Quién puede tocar una fila ya existente.
   *
   * Las dos negativas dicen cosas distintas a propósito. Una fila global SÍ
   * aparece en la lista de un gimnasio —necesita ver lo que heredan sus
   * socios—, así que negarla con un 404 sería mentir sobre algo que el propio
   * listado acaba de mostrar: es un 403. La fila de OTRO gimnasio no aparece en
   * ninguna parte, y responder 403 confirmaría que ese identificador existe;
   * por eso se responde lo mismo que si no existiera.
   */
  private assertEditable(
    actor: AuthenticatedUser,
    rowTenantId: string | null,
    notFoundMessage: string,
  ): void {
    if (actor.tenantScope === null) return;
    if (rowTenantId === actor.tenantScope) return;
    if (rowTenantId === null) {
      throw new ForbiddenException(
        "El catálogo global lo administra la plataforma, no un gimnasio.",
      );
    }
    throw new NotFoundException(notFoundMessage);
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
