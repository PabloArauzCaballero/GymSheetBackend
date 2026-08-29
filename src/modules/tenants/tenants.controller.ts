import { Controller, Get } from "@nestjs/common";
import { Roles } from "../../common/decorators/roles.decorator";
import { UserRole } from "../../common/enums/domain.enums";
import { TenantsService } from "./tenants.service";

/**
 * Catálogo de gimnasios para la consola de sistema.
 *
 * Sólo `SYSTEM_ADMIN`: la lista de gimnasios es la lista de clientes del
 * negocio, y un `ADMIN` —que administra uno solo— no tiene por qué verla.
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
