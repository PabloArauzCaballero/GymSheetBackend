import { Controller, Get } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../common/types/auth-context.types';
import { UsersService } from './users.service';

@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('me')
  async getMyUser(@CurrentUser() currentUser: AuthenticatedUser) {
    const user = await this.usersService.getActiveUserOrFail(currentUser.id);
    return {
      id: user.id,
      email: user.email,
      nombreCompleto: user.nombreCompleto,
      rol: user.rol,
      estado: user.estado,
      fechaRegistro: user.fechaRegistro,
    };
  }
}
