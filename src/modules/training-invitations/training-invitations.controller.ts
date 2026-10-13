import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Res,
} from "@nestjs/common";
import { Response } from "express";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { AuthenticatedUser } from "../../common/types/auth-context.types";
import {
  counterproposeTrainingInviteSchema,
  CounterproposeTrainingInviteInput,
  createTrainingInviteSchema,
  CreateTrainingInviteInput,
  respondTrainingInviteSchema,
  RespondTrainingInviteInput,
} from "./training-invite.schemas";
import { TrainingInvitationsService } from "./training-invitations.service";
import { TrainingInvitationCalendarService } from "./calendar.service";

@Controller("me/training-invitations")
export class TrainingInvitationsController {
  constructor(
    private readonly invitations: TrainingInvitationsService,
    private readonly calendar: TrainingInvitationCalendarService,
  ) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.invitations.listForUser(user.id);
  }

  @Get(":id/shared-session")
  sharedSession(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", ParseUUIDPipe) inviteId: string,
  ) {
    return this.invitations.getSharedSession(inviteId, user.id);
  }

  @Get(":id/calendar.ics")
  async downloadCalendar(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", ParseUUIDPipe) inviteId: string,
    @Res() response: Response,
  ): Promise<void> {
    const body = await this.calendar.forParticipant(inviteId, user.id);
    response
      .status(200)
      .set({
        "Content-Type": "text/calendar; charset=utf-8",
        "Content-Disposition": `attachment; filename="gymsheet-training-${inviteId}.ics"`,
        "Cache-Control": "private, no-store",
      })
      .send(body);
  }

  @Post()
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(createTrainingInviteSchema))
    input: CreateTrainingInviteInput,
  ) {
    return this.invitations.create(user.id, user.tenantId, input);
  }

  @Post(":id/respond")
  @HttpCode(200)
  respond(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", ParseUUIDPipe) inviteId: string,
    @Body(new ZodValidationPipe(respondTrainingInviteSchema))
    input: RespondTrainingInviteInput,
  ) {
    return this.invitations.respond(user.id, inviteId, input);
  }

  @Post(":id/counterpropose")
  @HttpCode(200)
  counterpropose(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", ParseUUIDPipe) inviteId: string,
    @Body(new ZodValidationPipe(counterproposeTrainingInviteSchema))
    input: CounterproposeTrainingInviteInput,
  ) {
    return this.invitations.counterpropose(
      user.id,
      user.tenantId,
      inviteId,
      input,
    );
  }
}
