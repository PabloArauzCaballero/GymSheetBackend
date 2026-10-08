import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { UuidParamPipe } from '../../common/pipes/uuid-param.pipe';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { AuthenticatedUser } from '../../common/types/auth-context.types';
import { ProgramsActivationService } from './programs-activation.service';
import { ProgramsLifecycleService } from './programs-lifecycle.service';
import { ProgramsQueryService } from './programs-query.service';
import {
  ActivateStrengthInput,
  CloseProgramInput,
  activateStrengthSchema,
  closeProgramSchema,
} from './programs.schemas';

@Controller('programs')
export class ProgramsController {
  constructor(
    private readonly activation: ProgramsActivationService,
    private readonly lifecycle: ProgramsLifecycleService,
    private readonly query: ProgramsQueryService,
  ) {}

  @Get('active')
  active(@CurrentUser() user: AuthenticatedUser) {
    return this.query.getActive(user.id);
  }

  @Post('strength/activate')
  activateStrength(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(activateStrengthSchema)) input: ActivateStrengthInput,
  ) {
    return this.activation.activateStrength(user, input);
  }

  @Post(':id/stop')
  stop(@CurrentUser() user: AuthenticatedUser, @Param('id', UuidParamPipe) id: string) {
    return this.lifecycle.stop(user.id, id);
  }

  @Post(':id/close')
  close(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', UuidParamPipe) id: string,
    @Body(new ZodValidationPipe(closeProgramSchema)) input: CloseProgramInput,
  ) {
    return this.lifecycle.close(user, id, input);
  }

  @Get(':id/progress')
  progress(@CurrentUser() user: AuthenticatedUser, @Param('id', UuidParamPipe) id: string) {
    return this.query.progress(user.id, id);
  }

  @Get(':id/next-loads')
  nextLoads(@CurrentUser() user: AuthenticatedUser, @Param('id', UuidParamPipe) id: string) {
    return this.query.nextLoads(user.id, id);
  }
}
