import { Body, Controller, Get, Post, Query } from "@nestjs/common";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { AuthenticatedUser } from "../../common/types/auth-context.types";
import { ProfileViewsService } from "./profile-views.service";
import {
  ProfileViewersQuery,
  RecordProfileViewInput,
  profileViewersQuerySchema,
  recordProfileViewSchema,
} from "./profile-views.schemas";

@Controller("me/profile-views")
export class ProfileViewsController {
  constructor(private readonly service: ProfileViewsService) {}

  @Post()
  async record(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(recordProfileViewSchema)) input: RecordProfileViewInput,
  ) {
    await this.service.record(user.id, user.tenantId, input.viewedUserId);
    return { recorded: true };
  }

  /**
   * La lista siempre es la del propio llamante: el dueño sale del JWT y no de
   * la ruta ni del cursor, así que no hay forma de pedir la de otra persona.
   */
  @Get()
  listViewers(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodValidationPipe(profileViewersQuerySchema)) query: ProfileViewersQuery,
  ) {
    return this.service.listViewers(user.id, user.tenantId, query);
  }

  @Get("summary")
  summary(@CurrentUser() user: AuthenticatedUser) {
    return this.service.summary(user.id, user.tenantId);
  }

  /** Deja la lista "sin novedades": lo que ya está visto deja de contar como nuevo. */
  @Post("checked")
  markChecked(@CurrentUser() user: AuthenticatedUser) {
    return this.service.markChecked(user.id);
  }
}
