import { Injectable } from "@nestjs/common";
import { QueryTypes, Transaction } from "sequelize";
import { Sequelize } from "sequelize-typescript";
import {
  CouponRecord,
  PrizeTargetKind,
  generatePrizeCode,
  hasStock,
  prizeExpiry,
} from "./prizes";

/** Premio del catálogo de un gimnasio (o global, con `tenantId` nulo). */
export interface PrizeRecord {
  id: string;
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
  createdAt: Date;
  updatedAt: Date;
}

export interface PrizeValues {
  targetKind: PrizeTargetKind;
  targetCode: string;
  title: string;
  description: string | null;
  instructions: string | null;
  icon: string;
  validDays: number | null;
  stock: number | null;
  active: boolean;
}

/** Un cupón con el gimnasio de su premio y el de su dueño, para decidir quién lo canjea. */
export interface CouponForRedeem extends CouponRecord {
  prizeTenantId: string | null;
  ownerTenantId: string | null;
}

const PRIZE_COLUMNS = `
  p.id, p.tenant_id AS "tenantId", p.target_kind AS "targetKind", p.target_code AS "targetCode",
  p.title, p.description, p.instructions, p.icon, p.valid_days AS "validDays", p.stock,
  p.granted_count AS "grantedCount", p.active, p.created_at AS "createdAt", p.updated_at AS "updatedAt"`;

const COUPON_COLUMNS = `
  up.id, up.prize_id AS "prizeId", up.usuario_id AS "userId", up.source_ref AS "sourceRef",
  up.code, up.status, up.awarded_at AS "awardedAt", up.expires_at AS "expiresAt",
  up.redeemed_at AS "redeemedAt", up.seen,
  p.title, p.description, p.instructions, p.icon, p.target_kind AS "targetKind", p.target_code AS "targetCode"`;

/** Intentos ante un código repetido: con mil millones de códigos, el segundo ya es casi imposible. */
const CODE_ATTEMPTS = 5;

/**
 * Acceso a datos de premios y cupones. SQL a mano, sin modelo ORM: nada de
 * esto se devuelve tal cual, y el otorgamiento necesita un bloqueo de fila y un
 * `ON CONFLICT` que es más claro escrito que traducido.
 */
@Injectable()
export class PrizesRepository {
  constructor(private readonly sequelize: Sequelize) {}

  // ───────────────────────────────────────────────────────────── catálogo

  /** Premios activos que alcanzan a un socio: los globales y los de su gimnasio. */
  listActiveFor(tenantId: string | null): Promise<PrizeRecord[]> {
    return this.sequelize.query<PrizeRecord>(
      `SELECT ${PRIZE_COLUMNS} FROM progression.prizes p
        WHERE p.active AND (p.tenant_id IS NULL OR p.tenant_id = :tenantId)
        ORDER BY p.created_at`,
      { type: QueryTypes.SELECT, replacements: { tenantId: tenantId ?? "" } },
    );
  }

  /** Lo que ve un administrador: todo (plataforma) o lo suyo más lo global (gimnasio). */
  listForAdmin(tenantScope: string | null): Promise<PrizeRecord[]> {
    return this.sequelize.query<PrizeRecord>(
      `SELECT ${PRIZE_COLUMNS} FROM progression.prizes p
        WHERE (:scope::text IS NULL OR p.tenant_id IS NULL OR p.tenant_id = :scope)
        ORDER BY p.active DESC, p.created_at DESC`,
      { type: QueryTypes.SELECT, replacements: { scope: tenantScope } },
    );
  }

  async findById(id: string): Promise<PrizeRecord | null> {
    const [row] = await this.sequelize.query<PrizeRecord>(
      `SELECT ${PRIZE_COLUMNS} FROM progression.prizes p WHERE p.id = :id`,
      { type: QueryTypes.SELECT, replacements: { id } },
    );
    return row ?? null;
  }

  async create(tenantId: string | null, values: PrizeValues): Promise<PrizeRecord> {
    const [row] = await this.sequelize.query<PrizeRecord>(
      `INSERT INTO progression.prizes AS p
         (tenant_id, target_kind, target_code, title, description, instructions, icon, valid_days, stock, active)
       VALUES (:tenantId, :targetKind, :targetCode, :title, :description, :instructions, :icon, :validDays, :stock, :active)
       RETURNING ${PRIZE_COLUMNS}`,
      { type: QueryTypes.SELECT, replacements: { tenantId, ...values } },
    );
    return row;
  }

  async update(id: string, values: Partial<PrizeValues>): Promise<PrizeRecord | null> {
    const columns: Record<keyof PrizeValues, string> = {
      targetKind: "target_kind",
      targetCode: "target_code",
      title: "title",
      description: "description",
      instructions: "instructions",
      icon: "icon",
      validDays: "valid_days",
      stock: "stock",
      active: "active",
    };
    // Solo nombres de columna de esta lista fija: nada de la petición llega al SQL salvo como parámetro.
    const keys = (Object.keys(columns) as (keyof PrizeValues)[]).filter((key) => values[key] !== undefined);
    if (keys.length === 0) return this.findById(id);
    const assignments = keys.map((key) => `${columns[key]} = :${key}`).join(", ");
    const [row] = await this.sequelize.query<PrizeRecord>(
      `UPDATE progression.prizes AS p SET ${assignments}, updated_at = now()
        WHERE p.id = :id
        RETURNING ${PRIZE_COLUMNS}`,
      { type: QueryTypes.SELECT, replacements: { id, ...values } },
    );
    return row ?? null;
  }

  // ───────────────────────────────────────────────────────────── cupones

  listCoupons(userId: string): Promise<CouponRecord[]> {
    return this.sequelize.query<CouponRecord>(
      `SELECT ${COUPON_COLUMNS}
         FROM progression.user_prizes up
         JOIN progression.prizes p ON p.id = up.prize_id
        WHERE up.usuario_id = :userId
        ORDER BY up.awarded_at DESC, up.id`,
      { type: QueryTypes.SELECT, replacements: { userId } },
    );
  }

  /**
   * Otorga un cupón si todavía no existe y queda stock.
   *
   * El premio se bloquea (`FOR UPDATE`) durante la transacción: dos socios que
   * consiguen el hito a la vez con una sola unidad de stock no pueden llevarse
   * los dos. El `UNIQUE (premio, socio, origen)` hace el resto idempotente.
   * Devuelve el cupón nuevo, o `null` si ya existía, no queda stock o el premio
   * se retiró entre la lectura y la escritura.
   */
  grant(prizeId: string, userId: string, sourceRef: string): Promise<CouponRecord | null> {
    return this.sequelize.transaction(async (transaction) => {
      const [prize] = await this.sequelize.query<{ stock: number | null; granted: number; active: boolean; validDays: number | null }>(
        `SELECT stock, granted_count AS granted, active, valid_days AS "validDays"
           FROM progression.prizes WHERE id = :prizeId FOR UPDATE`,
        { type: QueryTypes.SELECT, replacements: { prizeId }, transaction },
      );
      if (!prize || !prize.active || !hasStock(prize.stock, Number(prize.granted))) return null;

      const inserted = await this.insertCoupon(prizeId, userId, sourceRef, prize.validDays, transaction);
      if (!inserted) return null;
      await this.sequelize.query(
        `UPDATE progression.prizes SET granted_count = granted_count + 1 WHERE id = :prizeId`,
        { replacements: { prizeId }, transaction },
      );
      return this.findCoupon(inserted, transaction);
    });
  }

  private async insertCoupon(
    prizeId: string,
    userId: string,
    sourceRef: string,
    validDays: number | null,
    transaction: Transaction,
  ): Promise<string | null> {
    const awardedAt = new Date();
    for (let attempt = 0; attempt < CODE_ATTEMPTS; attempt += 1) {
      // `DO NOTHING` sin columnas cubre las dos unicidades: el cupón ya existía
      // (fin, idempotente) o el código cayó en uno ajeno (otro intento).
      const rows = await this.sequelize.query<{ id: string }>(
        `INSERT INTO progression.user_prizes (prize_id, usuario_id, source_ref, code, awarded_at, expires_at)
         VALUES (:prizeId, :userId, :sourceRef, :code, :awardedAt, :expiresAt)
         ON CONFLICT DO NOTHING
         RETURNING id`,
        {
          type: QueryTypes.SELECT,
          replacements: {
            prizeId,
            userId,
            sourceRef,
            code: generatePrizeCode(),
            awardedAt,
            expiresAt: prizeExpiry(awardedAt, validDays),
          },
          transaction,
        },
      );
      if (rows[0]) return rows[0].id;
      const [existing] = await this.sequelize.query<{ id: string }>(
        `SELECT id FROM progression.user_prizes
          WHERE prize_id = :prizeId AND usuario_id = :userId AND source_ref = :sourceRef`,
        { type: QueryTypes.SELECT, replacements: { prizeId, userId, sourceRef }, transaction },
      );
      if (existing) return null;
    }
    throw new Error("No se pudo generar un código de cupón libre.");
  }

  private async findCoupon(id: string, transaction?: Transaction): Promise<CouponRecord | null> {
    const [row] = await this.sequelize.query<CouponRecord>(
      `SELECT ${COUPON_COLUMNS}
         FROM progression.user_prizes up JOIN progression.prizes p ON p.id = up.prize_id
        WHERE up.id = :id`,
      { type: QueryTypes.SELECT, replacements: { id }, transaction },
    );
    return row ?? null;
  }

  async findCouponByCode(code: string): Promise<CouponForRedeem | null> {
    const [row] = await this.sequelize.query<CouponForRedeem>(
      `SELECT ${COUPON_COLUMNS}, p.tenant_id AS "prizeTenantId", u.tenant_id AS "ownerTenantId"
         FROM progression.user_prizes up
         JOIN progression.prizes p ON p.id = up.prize_id
         JOIN public.usuarios u ON u.id = up.usuario_id
        WHERE up.code = :code`,
      { type: QueryTypes.SELECT, replacements: { code } },
    );
    return row ?? null;
  }

  /**
   * Canje: una sola vez y solo si sigue vigente. La condición va en el propio
   * UPDATE, así que dos recepciones canjeando el mismo código a la vez no
   * pueden ganar las dos.
   */
  async redeem(id: string, redeemedBy: string): Promise<CouponRecord | null> {
    const rows = await this.sequelize.query<{ id: string }>(
      `UPDATE progression.user_prizes
          SET status = 'CANJEADO', redeemed_at = now(), redeemed_by = :redeemedBy
        WHERE id = :id AND status = 'DISPONIBLE'
          AND (expires_at IS NULL OR expires_at > now())
        RETURNING id`,
      { type: QueryTypes.SELECT, replacements: { id, redeemedBy } },
    );
    return rows[0] ? this.findCoupon(rows[0].id) : null;
  }

  async markSeen(userId: string): Promise<void> {
    await this.sequelize.query(
      `UPDATE progression.user_prizes SET seen = true WHERE usuario_id = :userId AND NOT seen`,
      { replacements: { userId } },
    );
  }

  /** Nombre visible del hito de un premio, para el ticket. Prefiere la fila del gimnasio a la global. */
  async targetName(kind: PrizeTargetKind, code: string, tenantId: string | null): Promise<string | null> {
    if (kind === "PERFECT_WEEK") return null;
    const table = kind === "BADGE" ? "progression.badges" : "progression.levels";
    const [row] = await this.sequelize.query<{ name: string }>(
      `SELECT name FROM ${table}
        WHERE code = :code AND (tenant_id IS NULL OR tenant_id = :tenantId)
        ORDER BY tenant_id NULLS LAST, audience = 'ANY' DESC
        LIMIT 1`,
      { type: QueryTypes.SELECT, replacements: { code, tenantId: tenantId ?? "" } },
    );
    return row?.name ?? null;
  }

  /** ¿Existe ese hito en el catálogo que vería el gimnasio del premio? */
  async targetExists(kind: PrizeTargetKind, code: string, tenantId: string | null): Promise<boolean> {
    return (await this.targetName(kind, code, tenantId)) !== null;
  }
}
