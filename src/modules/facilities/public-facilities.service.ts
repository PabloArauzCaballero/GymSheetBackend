import { Injectable, NotFoundException } from '@nestjs/common';
import { mapPublicBranchDetail, mapPublicBranchSummary } from './public-facilities.mapper';
import { PublicFacilitiesRepository } from './public-facilities.repository';
import { PublicBranchListQuery } from './public-facilities.schemas';

@Injectable()
export class PublicFacilitiesService {
  constructor(private readonly repository: PublicFacilitiesRepository) {}

  async listBranches(query: PublicBranchListQuery) {
    const branches = await this.repository.listActiveBranches(query);
    return branches.map(mapPublicBranchSummary);
  }

  /**
   * Sedes del gimnasio del socio, con la misma proyección segura que el
   * directorio público: la sesión acota el alcance, no amplía lo que se ve.
   */
  async listTenantBranches(tenantId: string) {
    const branches = await this.repository.listActiveBranchesByTenant(tenantId);
    return branches.map(mapPublicBranchSummary);
  }

  async getBranch(id: string) {
    const branch = await this.repository.findActiveBranchDetail(id);
    if (!branch) throw new NotFoundException('Gimnasio no encontrado.');
    // Sin marca, la sede es su propia cadena de uno: el mapa y el listado de
    // "otras sucursales" siguen funcionando igual, solo que con un elemento.
    const siblings = branch.brandName
      ? await this.repository.listActiveBranchesByBrand(branch.brandName)
      : [branch];
    return mapPublicBranchDetail(branch, siblings);
  }
}
