import { Injectable } from "@nestjs/common";
import { InjectModel } from "@nestjs/sequelize";
import { TenantModel } from "./tenant.model";

@Injectable()
export class TenantsRepository {
  constructor(
    @InjectModel(TenantModel) private readonly tenantModel: typeof TenantModel,
  ) {}

  listAll(): Promise<TenantModel[]> {
    return this.tenantModel.findAll({ order: [["nombre", "ASC"]] });
  }

  findById(tenantId: string): Promise<TenantModel | null> {
    return this.tenantModel.findByPk(tenantId);
  }

  /**
   * Existencia + actividad en una sola consulta: es la comprobación que hacen
   * el registro público y la suplantación, y separarla en dos pasos invitaría
   * a que alguna ruta comprobase sólo la primera mitad.
   */
  async existsActive(tenantId: string): Promise<boolean> {
    const count = await this.tenantModel.count({
      where: { id: tenantId, estado: "ACTIVO" },
    });
    return count > 0;
  }
}
