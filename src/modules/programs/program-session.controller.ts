import { Body, Controller, Param, Post } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { UuidParamPipe } from '../../common/pipes/uuid-param.pipe';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { AuthenticatedUser } from '../../common/types/auth-context.types';
import { ProgramRoutineChangesService } from './program-routine-changes.service';
import { ApplyToRoutineInput, applyToRoutineSchema } from './programs.schemas';

@Controller('workouts')
export class ProgramSessionController {
  constructor(private readonly changes: ProgramRoutineChangesService) {}

  @Post(':id/apply-to-routine')
  apply(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', UuidParamPipe) sessionId: string,
    @Body(new ZodValidationPipe(applyToRoutineSchema)) input: ApplyToRoutineInput,
  ) {
    return this.changes.apply(user, sessionId, input);
  }
}
