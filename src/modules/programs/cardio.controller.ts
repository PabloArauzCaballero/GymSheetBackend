import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { UuidParamPipe } from '../../common/pipes/uuid-param.pipe';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { AuthenticatedUser } from '../../common/types/auth-context.types';
import { CardioPlansService } from './cardio-plans.service';
import { ProgramsCardioService } from './programs-cardio.service';
import {
  ActivateCardioInput,
  CardioPlanInput,
  CardioPlanPatch,
  activateCardioSchema,
  cardioPlanPatchSchema,
  cardioPlanSchema,
} from './cardio.schemas';

@Controller()
export class CardioController {
  constructor(
    private readonly plans: CardioPlansService,
    private readonly cardio: ProgramsCardioService,
  ) {}

  @Post('cardio-plans')
  create(@CurrentUser() user: AuthenticatedUser, @Body(new ZodValidationPipe(cardioPlanSchema)) input: CardioPlanInput) {
    return this.plans.create(user.id, input);
  }

  @Get('cardio-plans')
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.plans.list(user.id);
  }

  @Patch('cardio-plans/:id')
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', UuidParamPipe) id: string,
    @Body(new ZodValidationPipe(cardioPlanPatchSchema)) patch: CardioPlanPatch,
  ) {
    return this.plans.update(user.id, id, patch);
  }

  @Post('programs/cardio/activate')
  activate(@CurrentUser() user: AuthenticatedUser, @Body(new ZodValidationPipe(activateCardioSchema)) input: ActivateCardioInput) {
    return this.cardio.activate(user, input);
  }
}
