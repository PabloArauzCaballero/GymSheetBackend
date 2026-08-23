import { Body, Controller, Get, Patch } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { AuthenticatedUser } from '../../common/types/auth-context.types';
import { mapUserToResponse, UserResponse } from './user.mapper';
import {
  UpdateMyAccountInput,
  updateMyAccountSchema,
} from './users.schemas';
import { UsersService } from './users.service';

@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('me')
  async getMyUser(@CurrentUser() authenticatedUser: AuthenticatedUser): Promise<UserResponse> {
    const user = await this.usersService.getActiveUserOrFail(authenticatedUser.id);
    return mapUserToResponse(user);
  }

  @Patch('me')
  async updateMyUser(
    @CurrentUser() authenticatedUser: AuthenticatedUser,
    @Body(new ZodValidationPipe(updateMyAccountSchema)) input: UpdateMyAccountInput,
  ): Promise<UserResponse> {
    const user = await this.usersService.updateMyAccount(authenticatedUser.id, input);
    return mapUserToResponse(user);
  }
}
