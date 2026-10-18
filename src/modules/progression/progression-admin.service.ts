import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { UniqueConstraintError } from "sequelize";
import { resolveCatalogTenant } from "../../common/tenancy/catalog-scope";
import { AuthenticatedUser } from "../../common/types/auth-context.types";
import { env } from "../../config/env";
import {
  PERFECT_WEEK_TARGET_CODE,
  PrizeTargetKind,
  PrizeView,
  effectivePrizeStatus,
  toPrizeView,
} from "./prizes";
import { PrizeRecord, PrizesRepository } from "./prizes.repository";
import { ProgressionRepository } from "./progression.repository";
import {
  CreateBadgeInput,
  CreateLevelInput,
  CreatePrizeInput,
  UpdateBadgeInput,
  UpdateLevelInput,
  UpdatePrizeInput,
} from "./progression.schemas";

/** Premio tal como lo ve la administración: con su stock y lo ya repartido. */
export interface AdminPrizeView {
  id: string;
  /** `null` = premio de la plataforma para todos los gimnasios. */
  tenantId: string | null;
  targetKind: PrizeTargetKind;
  targetCode: string;
  title: string;
  description: string | null;
  instructions: string | null;
  icon: string;
  validDays: number | null;
  stock: number | null;
  grantedCount: number;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

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
  constructor(
    private readonly repository: ProgressionRepository,
    private readonly prizes: PrizesRepository,
  ) {}

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

  // ───────────────────────────────────────────────────────────── premios

  async listPrizes(actor: AuthenticatedUser): Promise<AdminPrizeView[]> {
    return (await this.prizes.listForAdmin(actor.tenantScope)).map(toAdminPrizeView);
  }

  async createPrize(actor: AuthenticatedUser, input: CreatePrizeInput): Promise<AdminPrizeView> {
    const { alcance, ...values } = input;
    const tenantId = resolveCatalogTenant(actor, alcance);
    const targetCode = await this.resolveTarget(values.targetKind, values.targetCode, tenantId);
    return toAdminPrizeView(await this.prizes.create(tenantId, { ...values, targetCode }));
  }

  async updatePrize(actor: AuthenticatedUser, id: string, input: UpdatePrizeInput): Promise<AdminPrizeView> {
    const prize = await this.prizes.findById(id);
    if (!prize) throw new NotFoundException("Premio no encontrado.");
    this.assertEditable(actor, prize.tenantId, "Premio no encontrado.");
    const retargeted = input.targetKind !== undefined || input.targetCode !== undefined;
    const targetKind = input.targetKind ?? prize.targetKind;
    const targetCode = retargeted
      ? await this.resolveTarget(targetKind, input.targetCode ?? prize.targetCode, prize.tenantId)
      : undefined;
    const updated = await this.prizes.update(id, { ...input, targetKind, ...(targetCode ? { targetCode } : {}) });
    if (!updated) throw new NotFoundException("Premio no encontrado.");
    return toAdminPrizeView(updated);
  }

  /** Retirar no borra: los cupones ya dados apuntan a su premio y se siguen pudiendo canjear. */
  async deactivatePrize(actor: AuthenticatedUser, id: string) {
    const prize = await this.prizes.findById(id);
    if (!prize) throw new NotFoundException("Premio no encontrado.");
    this.assertEditable(actor, prize.tenantId, "Premio no encontrado.");
    await this.prizes.update(id, { active: false });
    return { id, active: false };
  }

  /**
   * Canje en recepción.
   *
   * Un gimnasio canjea los cupones de SUS premios y los de premios globales
   * que tengan sus socios. Un código de otro gimnasio responde 404, igual que
   * uno inexistente: confirmar que existe sería dar pistas para adivinar
   * códigos ajenos. Ya canjeado o caducado es un 409 con el motivo, porque
   * quien está en recepción necesita saber qué decirle al socio.
   */
  async redeemPrize(actor: AuthenticatedUser, code: string): Promise<PrizeView> {
    const coupon = await this.prizes.findCouponByCode(code);
    const ownerTenant = coupon ? coupon.ownerTenantId ?? env.DEFAULT_TENANT_ID ?? null : null;
    const visible =
      coupon !== null &&
      (actor.tenantScope === null ||
        coupon.prizeTenantId === actor.tenantScope ||
        (coupon.prizeTenantId === null && ownerTenant === actor.tenantScope));
    if (!coupon || !visible) throw new NotFoundException("Cupón no encontrado.");

    const status = effectivePrizeStatus(coupon.status, coupon.expiresAt);
    if (status === "CANJEADO") throw new ConflictException("Este cupón ya se canjeó.");
    if (status === "CADUCADO") throw new ConflictException("Este cupón caducó.");

    const redeemed = await this.prizes.redeem(coupon.id, actor.id);
    // Otra recepción lo canjeó entre la lectura y la escritura.
    if (!redeemed) throw new ConflictException("Este cupón ya se canjeó.");
    const tenantForName = coupon.prizeTenantId ?? ownerTenant;
    const name =
      redeemed.targetKind === "PERFECT_WEEK"
        ? "Semana redonda"
        : ((await this.prizes.targetName(redeemed.targetKind, redeemed.targetCode, tenantForName)) ??
          redeemed.targetCode);
    return toPrizeView(redeemed, name);
  }

  /**
   * El hito tiene que existir en el catálogo que verían los socios del premio:
   * un premio atado a una insignia que no existe no se otorgaría nunca, y
   * nadie se enteraría.
   */
  private async resolveTarget(
    kind: PrizeTargetKind,
    code: string | undefined,
    tenantId: string | null,
  ): Promise<string> {
    if (kind === "PERFECT_WEEK") return PERFECT_WEEK_TARGET_CODE;
    if (!code) throw new BadRequestException("Indica `targetCode`: el código de la insignia o del rango.");
    if (!(await this.prizes.targetExists(kind, code, tenantId))) {
      throw new BadRequestException(
        kind === "BADGE" ? `No existe la insignia ${code}.` : `No existe el rango ${code}.`,
      );
    }
    return code;
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

function toAdminPrizeView(prize: PrizeRecord): AdminPrizeView {
  return {
    id: prize.id,
    tenantId: prize.tenantId,
    targetKind: prize.targetKind,
    targetCode: prize.targetCode,
    title: prize.title,
    description: prize.description,
    instructions: prize.instructions,
    icon: prize.icon,
    validDays: prize.validDays,
    stock: prize.stock,
    grantedCount: Number(prize.grantedCount),
    active: prize.active,
    createdAt: new Date(prize.createdAt).toISOString(),
    updatedAt: new Date(prize.updatedAt).toISOString(),
  };
}
