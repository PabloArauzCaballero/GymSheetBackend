import { Injectable } from "@nestjs/common";
import { QueryTypes, Transaction } from "sequelize";
import { Sequelize } from "sequelize-typescript";
import { env } from "../../config/env";
import { PLATFORM_TENANT_ID, brandNameOf } from "./product-name";

/**
 * Name an email to a person signs with: the display name of the person's gym
 * (tenant), or the product name for accounts of the platform itself. The
 * account's tenant falls back to `DEFAULT_TENANT_ID`, as everywhere else.
 */
@Injectable()
export class BrandNameService {
  constructor(private readonly sequelize: Sequelize) {}

  async forUser(userId: string, transaction?: Transaction): Promise<string> {
    const [row] = await this.sequelize.query<{ name: string }>(
      `SELECT t.nombre AS name
         FROM public.usuarios u
         JOIN public.tenants t ON t.id = COALESCE(u.tenant_id, :defaultTenantId)
        WHERE u.id = :userId AND t.id <> :platformTenantId`,
      {
        type: QueryTypes.SELECT,
        replacements: { userId, defaultTenantId: env.DEFAULT_TENANT_ID, platformTenantId: PLATFORM_TENANT_ID },
        transaction,
      },
    );
    return brandNameOf(row?.name);
  }
}
