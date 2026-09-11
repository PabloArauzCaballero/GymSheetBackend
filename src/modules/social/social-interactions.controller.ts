import { Controller, Delete, Get, Param, Query } from "@nestjs/common";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { UuidParamPipe } from "../../common/pipes/uuid-param.pipe";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { AuthenticatedUser } from "../../common/types/auth-context.types";
import { SocialInteractionsService } from "./social-interactions.service";
import { InteractionListQuery, interactionListQuerySchema } from "./social.schemas";

/**
 * Quién me dio like y quién me dio next, en las dos direcciones.
 *
 * Va en un controlador aparte de `SocialController` porque es otra pantalla con
 * otra pregunta: aquél gestiona el estado de las conexiones (enviar, aceptar,
 * retirar) y éste sólo mira hacia atrás — qué ha pasado conmigo. Sin prefijo en
 * `@Controller()`, como el resto del módulo: el `api/v1` lo pone `main.ts`.
 */
@Controller()
export class SocialInteractionsController {
  constructor(private readonly service: SocialInteractionsService) {}

  @Get("me/interactions/likes-received")
  likesReceived(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodValidationPipe(interactionListQuerySchema)) query: InteractionListQuery,
  ) {
    return this.service.likesReceived(user.id, user.tenantId, query);
  }

  @Get("me/interactions/likes-sent")
  likesSent(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodValidationPipe(interactionListQuerySchema)) query: InteractionListQuery,
  ) {
    return this.service.likesSent(user.id, user.tenantId, query);
  }

  @Get("me/interactions/passes-received")
  passesReceived(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodValidationPipe(interactionListQuerySchema)) query: InteractionListQuery,
  ) {
    return this.service.passesReceived(user.id, user.tenantId, query);
  }

  @Get("me/interactions/passes-sent")
  passesSent(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodValidationPipe(interactionListQuerySchema)) query: InteractionListQuery,
  ) {
    return this.service.passesSent(user.id, user.tenantId, query);
  }

  @Get("me/interactions/counts")
  counts(@CurrentUser() user: AuthenticatedUser) {
    return this.service.counts(user.id, user.tenantId);
  }

  /**
   * Devuelve a esa persona a la baraja.
   *
   * Sólo alcanza a los descartes propios: no existe —ni debe existir— la
   * operación simétrica sobre quien me descartó a mí. Ver la nota de privacidad
   * de `SocialInteractionsService`.
   */
  @Delete("me/interactions/passes/:userId")
  deletePass(
    @CurrentUser() user: AuthenticatedUser,
    @Param("userId", UuidParamPipe) targetUserId: string,
  ) {
    return this.service.deletePass(user.id, targetUserId);
  }
}
