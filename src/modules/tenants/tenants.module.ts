import { Module } from "@nestjs/common";
import { SequelizeModule } from "@nestjs/sequelize";
import { TenantModel } from "./tenant.model";
import { TenantsController } from "./tenants.controller";
import { TenantsRepository } from "./tenants.repository";
import { TenantsService } from "./tenants.service";

@Module({
  imports: [SequelizeModule.forFeature([TenantModel])],
  controllers: [TenantsController],
  providers: [TenantsRepository, TenantsService],
  // Exportado porque el registro público (H-03) y la suplantación validan el
  // gimnasio contra este catálogo.
  exports: [TenantsService, TenantsRepository],
})
export class TenantsModule {}
