import { Body, Controller, Get, Header, Param, Put, Req } from "@nestjs/common";
import { Request } from "express";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { AuthenticatedUser } from "../../common/types/auth-context.types";
import type { ConsentKind } from "../legal/consent-versions";
import { legalClientContext } from "../legal/legal-client-context";
import { consentKindSchema, SetConsentInput, setConsentSchema } from "./consents.schemas";
import { ConsentsService } from "./consents.service";

@Controller("me/consents")
export class ConsentsController {
  constructor(private readonly service: ConsentsService) {}

  @Get()
  @Header("Cache-Control", "private, no-store")
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.service.list(user.id);
  }

  @Put(":kind")
  set(
    @CurrentUser() user: AuthenticatedUser,
    @Param("kind", new ZodValidationPipe(consentKindSchema)) kind: ConsentKind,
    @Body(new ZodValidationPipe(setConsentSchema)) input: SetConsentInput,
    @Req() request: Request,
  ) {
    return this.service.set(user.id, kind, input, legalClientContext(request).channel);
  }
}
