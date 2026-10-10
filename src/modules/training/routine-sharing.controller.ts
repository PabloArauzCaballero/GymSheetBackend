import { Body, Controller, Delete, Get, Param, Post, Query } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { UuidParamPipe } from '../../common/pipes/uuid-param.pipe';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { AuthenticatedUser } from '../../common/types/auth-context.types';
import {
  InvitationListQuery,
  InviteInput,
  invitationListQuerySchema,
  inviteSchema,
} from './routine-v2.schemas';
import { RoutineSharingService } from './routine-sharing.service';

@Controller()
export class RoutineSharingController {
  constructor(private readonly sharing: RoutineSharingService) {}

  @Post('routines/:id/shares')
  invite(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', UuidParamPipe) routineId: string,
    @Body(new ZodValidationPipe(inviteSchema)) input: InviteInput,
  ) {
    return this.sharing.invite(user, routineId, input.userIds);
  }

  @Get('routines/:id/shares')
  list(@CurrentUser() user: AuthenticatedUser, @Param('id', UuidParamPipe) routineId: string) {
    return this.sharing.listForRoutine(user, routineId);
  }

  @Delete('routines/:id/shares/:shareId')
  revoke(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', UuidParamPipe) routineId: string,
    @Param('shareId', UuidParamPipe) shareId: string,
  ) {
    return this.sharing.revoke(user, routineId, shareId);
  }

  @Get('me/routine-invitations')
  mine(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodValidationPipe(invitationListQuerySchema)) query: InvitationListQuery,
  ) {
    return this.sharing.myInvitations(user.id, query.estado);
  }

  @Post('routine-shares/:shareId/accept')
  accept(@CurrentUser() user: AuthenticatedUser, @Param('shareId', UuidParamPipe) shareId: string) {
    return this.sharing.accept(user.id, shareId);
  }

  @Post('routine-shares/:shareId/decline')
  decline(@CurrentUser() user: AuthenticatedUser, @Param('shareId', UuidParamPipe) shareId: string) {
    return this.sharing.decline(user.id, shareId);
  }
}
