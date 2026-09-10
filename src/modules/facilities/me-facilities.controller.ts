import { Controller, Get } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../common/types/auth-context.types';
import { PublicFacilitiesService } from './public-facilities.service';

/**
 * Sedes vistas desde una sesión: solo las del gimnasio del usuario.
 *
 * Sin `@Public()` para que exija JWT, y sin `@Roles` a propósito — cualquier
 * rol autenticado tiene derecho a ver las sedes de su propio gimnasio, y el
 * `RolesGuard` deja pasar cuando no hay roles declarados.
 */
@Controller('me/facilities')
export class MeFacilitiesController {
  constructor(private readonly service: PublicFacilitiesService) {}

  @Get('branches')
  listMyBranches(@CurrentUser() user: AuthenticatedUser) {
    return this.service.listTenantBranches(user.tenantId);
  }
}
