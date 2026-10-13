import { Body, Controller, Get, Param, Patch } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { UuidParamPipe } from '../../common/pipes/uuid-param.pipe';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { AuthenticatedUser } from '../../common/types/auth-context.types';
import { RestSettingsInput, restSettingsSchema } from '../workouts/workouts.schemas';
import { SessionRestService } from './session-rest.service';

/** Descanso e intervalo a mano durante el entreno, con opción de guardarlo en la rutina (D2). */
@Controller('workouts')
export class SessionRestController {
  constructor(private readonly sessionRest: SessionRestService) {}

  @Get(':id/routine-link')
  routineLink(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', UuidParamPipe) sessionId: string,
  ) {
    return this.sessionRest.routineLink(user, sessionId);
  }

  @Patch(':id/rest-settings')
  apply(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', UuidParamPipe) sessionId: string,
    @Body(new ZodValidationPipe(restSettingsSchema)) input: RestSettingsInput,
  ) {
    return this.sessionRest.apply(user, sessionId, input);
  }
}
