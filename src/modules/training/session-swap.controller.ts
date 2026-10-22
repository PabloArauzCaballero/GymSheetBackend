import { Body, Controller, Param, Post } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { UuidParamPipe } from '../../common/pipes/uuid-param.pipe';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { AuthenticatedUser } from '../../common/types/auth-context.types';
import { SwapSessionExerciseInput, swapSessionExerciseSchema } from '../workouts/free-workout.schemas';
import { SessionSwapService } from './session-swap.service';

/** Cambiar un ejercicio a mitad de entreno, con motivo y alcance (solo hoy / siempre). */
@Controller('workouts')
export class SessionSwapController {
  constructor(private readonly sessionSwap: SessionSwapService) {}

  @Post('session-exercises/:id/swap')
  swap(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', UuidParamPipe) sessionExerciseId: string,
    @Body(new ZodValidationPipe(swapSessionExerciseSchema)) input: SwapSessionExerciseInput,
  ) {
    return this.sessionSwap.swap(user, sessionExerciseId, input);
  }
}
