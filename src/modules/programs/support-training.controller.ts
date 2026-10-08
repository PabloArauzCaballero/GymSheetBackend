import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { z } from 'zod';
import { Audited } from '../../common/decorators/audited.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../../common/enums/domain.enums';
import { UuidParamPipe } from '../../common/pipes/uuid-param.pipe';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { AuthenticatedUser } from '../../common/types/auth-context.types';
import { AdminPermissionKey } from '../admin-access/admin-permission.catalog';
import { SupportTrainingService } from './support-training.service';

const recomputeSchema = z.object({ semana: z.number().int().min(1).max(60) });

@Roles(UserRole.ADMIN, UserRole.FRONT_DESK)
@Controller('admin/support')
export class SupportTrainingController {
  constructor(private readonly support: SupportTrainingService) {}

  @Get('users/:userId/training')
  @RequirePermission(AdminPermissionKey.SUPPORT_READ)
  training(@CurrentUser() actor: AuthenticatedUser, @Param('userId', UuidParamPipe) userId: string) {
    return this.support.trainingOf(userId, actor.tenantScope);
  }

  @Post('programs/:id/recompute-week')
  @RequirePermission(AdminPermissionKey.SUPPORT_RESPOND)
  @Audited({ domain: 'support', action: 'recompute-week', targetKind: 'program', targetParam: 'id' })
  recompute(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', UuidParamPipe) id: string,
    @Body(new ZodValidationPipe(recomputeSchema)) body: { semana: number },
  ) {
    return this.support.recomputeWeek(id, body.semana, actor.tenantScope);
  }
}
