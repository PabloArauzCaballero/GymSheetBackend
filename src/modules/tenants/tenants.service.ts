import { Injectable, NotFoundException } from "@nestjs/common";
import { mapTenantToResponse, TenantResponse } from "./tenant.mapper";
import { TenantsRepository } from "./tenants.repository";

@Injectable()
export class TenantsService {
  constructor(private readonly repository: TenantsRepository) {}

  async list(): Promise<TenantResponse[]> {
    return (await this.repository.listAll()).map(mapTenantToResponse);
  }

  /**
   * Resuelve un gimnasio que debe existir y estar activo.
   *
   * Es el punto único por el que pasan el registro público (H-03) y la
   * suplantación: mientras `usuarios.tenant_id` fue texto libre sin catálogo
   * detrás, bastaba conocer —o adivinar— la clave de un gimnasio para entrar
   * en su perímetro social.
   */
  async assertActiveTenant(tenantId: string): Promise<void> {
    if (!(await this.repository.existsActive(tenantId))) {
      throw new NotFoundException("El gimnasio indicado no existe o no está activo.");
    }
  }
}
