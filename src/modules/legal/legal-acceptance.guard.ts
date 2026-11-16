import { CanActivate, ExecutionContext, HttpStatus, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { Request } from "express";
import { IS_PUBLIC_ROUTE_KEY } from "../../common/decorators/public.decorator";
import { DomainException } from "../../common/errors/domain.exception";
import { AuthenticatedUser } from "../../common/types/auth-context.types";
import { env } from "../../config/env";
import { LegalService } from "./legal.service";
import { SKIP_LEGAL_ACCEPTANCE_KEY } from "./skip-legal-acceptance.decorator";

/** Route prefixes (after the API prefix) a person must reach to log in, read or accept the documents. */
const EXEMPT_PREFIXES = ["auth/", "legal/", "me/legal/", "health/"] as const;

/**
 * Blocks authenticated requests from accounts that have not accepted every
 * current legal document, with `428 LEGAL_ACCEPTANCE_REQUIRED`.
 *
 * Cost: exactly one extra query per authenticated, non-exempt request, a
 * single `NOT EXISTS` over the unique key (user_id, document, version). No
 * in-process cache on purpose: a version bump or an acceptance must take
 * effect on the next request on every instance, and a cache would need
 * cross-instance invalidation for a query that is already an index probe.
 * Guards run once per request, so there is nothing to memoize per request.
 */
@Injectable()
export class LegalAcceptanceGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly legalService: LegalService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== "http") return true;
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_ROUTE_KEY, targets)) return true;
    if (this.reflector.getAllAndOverride<boolean>(SKIP_LEGAL_ACCEPTANCE_KEY, targets)) return true;

    const request = context.switchToHttp().getRequest<Request & { user?: AuthenticatedUser }>();
    if (!request.user || isExemptPath(request.path)) return true;

    if (await this.legalService.hasPending(request.user.id)) {
      throw new DomainException(
        HttpStatus.PRECONDITION_REQUIRED,
        "LEGAL_ACCEPTANCE_REQUIRED",
        "Debes aceptar los términos y la política de privacidad vigentes para continuar.",
      );
    }
    return true;
  }
}

export function isExemptPath(path: string, apiPrefix: string = env.API_PREFIX): boolean {
  const prefix = `/${apiPrefix.replace(/^\/+|\/+$/g, "")}/`;
  const relative = path.startsWith(prefix) ? path.slice(prefix.length) : path.replace(/^\/+/, "");
  const normalized = relative.endsWith("/") ? relative : `${relative}/`;
  return EXEMPT_PREFIXES.some((exempt) => normalized.startsWith(exempt));
}
