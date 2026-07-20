import { Controller, Get } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../common/types/auth-context.types';
import { mapUserToResponse, UserResponse } from './user.mapper';
import { UsersService } from './users.service';

@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('me')
  async getMyUser(@CurrentUser() authenticatedUser: AuthenticatedUser): Promise<UserResponse> {
    const user = await this.usersService.getActiveUserOrFail(authenticatedUser.id);
    return mapUserToResponse(user);
  }
}
