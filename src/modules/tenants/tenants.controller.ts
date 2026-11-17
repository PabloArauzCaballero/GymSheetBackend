import { Controller, Get } from "@nestjs/common";
import { Roles } from "../../common/decorators/roles.decorator";
import { UserRole } from "../../common/enums/domain.enums";
import { TenantsService } from "./tenants.service";

/**
 * Catálogo de gimnasios para la consola de sistema.
 *
 * Sólo `SYSTEM_ADMIN`: la lista de gimnasios es la lista de clientes del
 * negocio (el gimnasio no tiene personal, ADR-0019 y ADR-0029).
 */
@Roles(UserRole.SYSTEM_ADMIN)
@Controller("admin/tenants")
export class TenantsController {
  constructor(private readonly tenantsService: TenantsService) {}

  @Get()
  list() {
    return this.tenantsService.list();
  }
}
