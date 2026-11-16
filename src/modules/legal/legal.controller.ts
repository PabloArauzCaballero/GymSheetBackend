import { Body, Controller, Get, Header, HttpCode, HttpStatus, Post, Req } from "@nestjs/common";
import { Request } from "express";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { Public } from "../../common/decorators/public.decorator";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { AuthenticatedUser } from "../../common/types/auth-context.types";
import { legalClientContext } from "./legal-client-context";
import { AcceptLegalDocumentsInput, acceptLegalDocumentsSchema } from "./legal.schemas";
import { LegalService } from "./legal.service";

@Controller()
export class LegalController {
  constructor(private readonly legalService: LegalService) {}

  /** Same answer for everyone and only changes on deploy, so shared caches may keep it briefly. */
  @Public()
  @Get("legal/current")
  @Header("Cache-Control", "public, max-age=300")
  current() {
    return this.legalService.currentDocuments();
  }

  @Get("me/legal/pending")
  @Header("Cache-Control", "private, no-store")
  pending(@CurrentUser() user: AuthenticatedUser) {
    return this.legalService.pending(user.id);
  }

  @Post("me/legal/accept")
  @HttpCode(HttpStatus.OK)
  accept(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(acceptLegalDocumentsSchema)) input: AcceptLegalDocumentsInput,
    @Req() request: Request,
  ) {
    return this.legalService.accept(user.id, input, legalClientContext(request));
  }
}
